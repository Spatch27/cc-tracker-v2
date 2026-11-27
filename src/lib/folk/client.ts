import { z } from "zod";
import {
  folkCompanySchema,
  folkCustomFieldSchema,
  folkGroupSchema,
  folkInteractionSchema,
  folkNoteSchema,
  folkPaginationSchema,
  folkPersonSchema,
  folkUserSchema,
  type FolkClientInterface,
  type FolkCompany,
  type FolkCreateInteractionInput,
  type FolkCreateNoteInput,
  type FolkCreatePersonInput,
  type FolkCustomField,
  type FolkGroup,
  type FolkInteraction,
  type FolkInteractionListParams,
  type FolkListParams,
  type FolkListResponse,
  type FolkNote,
  type FolkNoteListParams,
  type FolkPagination,
  type FolkPerson,
  type FolkUpdateCompanyInput,
  type FolkUpdatePersonInput,
  type FolkUser,
} from "./types";

export class FolkApiError extends Error {
  readonly status: number;
  readonly path: string;

  constructor(message: string, status: number, path: string) {
    super(message);
    this.name = "FolkApiError";
    this.status = status;
    this.path = path;
  }
}

export interface FolkClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
  maxRetries?: number;
  baseDelayMs?: number;
}

const DEFAULT_BASE_URL = "https://api.folk.app/v1";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isNaN(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000);
  }
  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }
  return null;
}

/**
 * Normalizes Folk list envelopes (`{ data: { items, pagination } }`,
 * `{ data: [...] }`, or `{ items, pagination }`) into a consistent shape.
 */
function extractListEnvelope<T>(
  raw: unknown,
  itemSchema: z.ZodType<T, z.ZodTypeDef, unknown>,
): FolkListResponse<T> {
  const envelope =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rawEnvelopeKeys = Object.keys(envelope);

  const dataLayer =
    envelope.data && typeof envelope.data === "object" && !Array.isArray(envelope.data)
      ? (envelope.data as Record<string, unknown>)
      : envelope;

  let rawItems: unknown[] = [];
  if (Array.isArray(envelope.data)) {
    rawItems = envelope.data;
  } else if (Array.isArray(dataLayer.items)) {
    rawItems = dataLayer.items;
  } else if (Array.isArray(dataLayer.results)) {
    rawItems = dataLayer.results;
  } else if (Array.isArray(raw)) {
    rawItems = raw;
  }

  const rawPagination =
    (dataLayer.pagination as Record<string, unknown> | undefined) ??
    (envelope.pagination as Record<string, unknown> | undefined);

  let pagination: FolkPagination | undefined;
  if (rawPagination && typeof rawPagination === "object") {
    const parsedPag = folkPaginationSchema.safeParse(rawPagination);
    if (parsedPag.success) {
      pagination = { ...parsedPag.data };
      if (!pagination.nextCursor && pagination.nextLink) {
        try {
          const url = new URL(pagination.nextLink, "https://api.folk.app");
          const cursor = url.searchParams.get("cursor");
          if (cursor) {
            pagination.nextCursor = cursor;
          }
        } catch {
          // Ignore malformed nextLink URLs; caller still sees raw nextLink.
        }
      }
    }
  }

  const items = rawItems.map((entry) => itemSchema.parse(entry));

  return {
    items,
    pagination,
    rawEnvelopeKeys,
  };
}

function extractSingleEntity<T>(
  raw: unknown,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): T {
  if (raw && typeof raw === "object" && "data" in raw) {
    const inner = (raw as { data: unknown }).data;
    if (inner && typeof inner === "object") {
      return schema.parse(inner);
    }
  }
  return schema.parse(raw);
}

/**
 * Typed REST client for Folk CRM v1 (`https://api.folk.app/v1`).
 * Never logs the API token or includes it in thrown error messages.
 */
export class FolkRestClient implements FolkClientInterface {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;

  constructor(options: FolkClientOptions) {
    if (!options.apiKey || options.apiKey.trim().length === 0) {
      throw new Error("FOLK_API_KEY is required to construct FolkRestClient");
    }
    this.apiKey = options.apiKey.trim();
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchFn = options.fetchFn ?? fetch;
    this.maxRetries = options.maxRetries ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 300;
  }

  private async request<T>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    query?: Record<string, string | number | undefined>,
    body?: unknown,
  ): Promise<T> {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${normalizedPath}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== "") {
          url.searchParams.set(k, String(v));
        }
      }
    }

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < this.maxRetries; attempt += 1) {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
      };
      if (body !== undefined) {
        headers["Content-Type"] = "application/json";
      }

      const response = await this.fetchFn(url.toString(), {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

      if (response.ok) {
        const text = await response.text();
        if (!text) return {} as T;
        return JSON.parse(text) as T;
      }

      const shouldRetry = response.status === 429 || response.status >= 500;
      let detail = "";
      if (response.status === 400 || response.status === 422) {
        try {
          const text = await response.text();
          if (text) {
            const parsed = JSON.parse(text) as Record<string, unknown>;
            const rawDetail =
              parsed.message ?? parsed.error ?? parsed.details ?? text;
            const serialized =
              typeof rawDetail === "string"
                ? rawDetail
                : JSON.stringify(rawDetail);
            if (!serialized.includes(this.apiKey)) {
              detail = `: ${serialized.slice(0, 200)}`;
            }
          }
        } catch {
          // Ignore unparseable validation error payloads.
        }
      }
      const safeMessage = `Folk API ${method} ${normalizedPath} failed with HTTP ${response.status}${detail}`;

      if (!shouldRetry || attempt === this.maxRetries - 1) {
        throw new FolkApiError(safeMessage, response.status, normalizedPath);
      }

      lastError = new FolkApiError(safeMessage, response.status, normalizedPath);
      const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
      const delayMs = retryAfterMs ?? this.baseDelayMs * Math.pow(2, attempt);
      await sleep(delayMs);
    }

    throw lastError ?? new FolkApiError(`Folk API ${method} ${normalizedPath} failed`, 500, normalizedPath);
  }

  async listUsers(params?: FolkListParams): Promise<FolkListResponse<FolkUser>> {
    const raw = await this.request<unknown>("GET", "/users", {
      limit: params?.limit,
      cursor: params?.cursor,
    });
    return extractListEnvelope(raw, folkUserSchema);
  }

  async listGroups(params?: FolkListParams): Promise<FolkListResponse<FolkGroup>> {
    const raw = await this.request<unknown>("GET", "/groups", {
      limit: params?.limit,
      cursor: params?.cursor,
    });
    return extractListEnvelope(raw, folkGroupSchema);
  }

  async listGroupCustomFields(
    groupId: string,
    entityType: "person" | "company" = "person",
  ): Promise<FolkListResponse<FolkCustomField>> {
    const path = `/groups/${encodeURIComponent(groupId)}/custom-fields/${entityType}`;
    const raw = await this.request<unknown>("GET", path);
    return extractListEnvelope(raw, folkCustomFieldSchema);
  }

  async listPeople(params?: FolkListParams): Promise<FolkListResponse<FolkPerson>> {
    const raw = await this.request<unknown>("GET", "/people", {
      limit: params?.limit,
      cursor: params?.cursor,
    });
    return extractListEnvelope(raw, folkPersonSchema);
  }

  async getPerson(personId: string): Promise<FolkPerson> {
    const raw = await this.request<unknown>(
      "GET",
      `/people/${encodeURIComponent(personId)}`,
    );
    return extractSingleEntity(raw, folkPersonSchema);
  }

  async listCompanies(params?: FolkListParams): Promise<FolkListResponse<FolkCompany>> {
    const raw = await this.request<unknown>("GET", "/companies", {
      limit: params?.limit,
      cursor: params?.cursor,
    });
    return extractListEnvelope(raw, folkCompanySchema);
  }

  async getCompany(companyId: string): Promise<FolkCompany> {
    const raw = await this.request<unknown>(
      "GET",
      `/companies/${encodeURIComponent(companyId)}`,
    );
    return extractSingleEntity(raw, folkCompanySchema);
  }

  async listNotes(params?: FolkNoteListParams): Promise<FolkListResponse<FolkNote>> {
    const raw = await this.request<unknown>("GET", "/notes", {
      limit: params?.limit,
      cursor: params?.cursor,
      query: params?.query,
      createdAfter: params?.createdAfter,
      createdBefore: params?.createdBefore,
    });
    return extractListEnvelope(raw, folkNoteSchema);
  }

  async listInteractions(
    params?: FolkInteractionListParams,
  ): Promise<FolkListResponse<FolkInteraction>> {
    const raw = await this.request<unknown>("GET", "/interactions", {
      limit: params?.limit,
      cursor: params?.cursor,
      "entity.id": params?.entityId,
      "filter[entity.id]": params?.filterEntityId,
      timeframe: params?.timeframe,
      importedTypes: params?.importedTypes,
      "user.id": params?.userId,
    });
    return extractListEnvelope(raw, folkInteractionSchema);
  }

  async getInteraction(interactionId: string): Promise<FolkInteraction> {
    const raw = await this.request<unknown>(
      "GET",
      `/interactions/${encodeURIComponent(interactionId)}`,
    );
    return extractSingleEntity(raw, folkInteractionSchema);
  }

  async createPerson(input: FolkCreatePersonInput): Promise<FolkPerson> {
    const raw = await this.request<unknown>("POST", "/people", undefined, input);
    return extractSingleEntity(raw, folkPersonSchema);
  }

  async updatePerson(
    personId: string,
    input: FolkUpdatePersonInput,
  ): Promise<FolkPerson> {
    const raw = await this.request<unknown>(
      "PATCH",
      `/people/${encodeURIComponent(personId)}`,
      undefined,
      input,
    );
    return extractSingleEntity(raw, folkPersonSchema);
  }

  async updateCompany(
    companyId: string,
    input: FolkUpdateCompanyInput,
  ): Promise<FolkCompany> {
    const raw = await this.request<unknown>(
      "PATCH",
      `/companies/${encodeURIComponent(companyId)}`,
      undefined,
      input,
    );
    return extractSingleEntity(raw, folkCompanySchema);
  }

  async createNote(input: FolkCreateNoteInput): Promise<FolkNote> {
    const raw = await this.request<unknown>("POST", "/notes", undefined, input);
    return extractSingleEntity(raw, folkNoteSchema);
  }

  async createInteraction(
    input: FolkCreateInteractionInput,
  ): Promise<FolkInteraction> {
    const raw = await this.request<unknown>(
      "POST",
      "/interactions",
      undefined,
      input,
    );
    return extractSingleEntity(raw, folkInteractionSchema);
  }
}

export async function listAllFolkPeople(
  client: FolkClientInterface,
  maxPages = 25,
): Promise<{ items: FolkPerson[]; pagesFetched: number; truncated: boolean }> {
  const items: FolkPerson[] = [];
  let cursor: string | undefined;
  let pagesFetched = 0;
  let truncated = false;
  const seenCursors = new Set<string>();

  while (pagesFetched < maxPages) {
    const page = await client.listPeople({ limit: 100, cursor });
    items.push(...page.items);
    pagesFetched += 1;

    const nextCursor = page.pagination?.nextCursor ?? undefined;
    if (!nextCursor || seenCursors.has(nextCursor)) {
      break;
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
    if (pagesFetched >= maxPages) {
      truncated = true;
    }
  }

  return { items, pagesFetched, truncated };
}

export function createFolkClientFromEnv(): FolkRestClient | null {
  const apiKey = process.env.FOLK_API_KEY?.trim();
  if (!apiKey) return null;
  return new FolkRestClient({
    apiKey,
    baseUrl: process.env.FOLK_API_BASE_URL?.trim() || DEFAULT_BASE_URL,
  });
}
