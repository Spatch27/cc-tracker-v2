import { FolkApiError } from "./client";
import type { FolkClientInterface, FolkPerson } from "./types";

export interface ProbeEndpointResult {
  endpoint: string;
  status: number | "OK";
  itemCount: number;
  fieldKeys: string[];
  hasNextCursor: boolean;
  notes: string;
}

export interface FolkProbeReport {
  generatedAt: string;
  baseUrl: string;
  results: ProbeEndpointResult[];
  observations: string[];
  totalRecordsRead: number;
  distinctInteractionUserIds: string[];
  hasThreadOrConversationId: boolean;
  markdownReport: string;
}

function collectKeys(items: Record<string, unknown>[]): string[] {
  const keys = new Set<string>();
  for (const item of items) {
    for (const k of Object.keys(item)) {
      keys.add(k);
    }
  }
  return Array.from(keys).sort();
}

function selectPeopleForInteractionProbe(people: FolkPerson[]): FolkPerson[] {
  const withMetadata = people.filter((p) => {
    const meta = (p as Record<string, unknown>).interactionMetadata;
    return meta !== undefined && meta !== null;
  });
  const candidates = withMetadata.length > 0 ? withMetadata : people;
  return candidates.slice(0, 3);
}

/**
 * Executes strictly read-only (GET) checks against Folk CRM API v1.
 * Never invokes any write methods and redacts PII / message bodies.
 */
export async function runFolkReadOnlyProbe(
  client: FolkClientInterface,
  baseUrl = "https://api.folk.app/v1",
): Promise<FolkProbeReport> {
  const generatedAt = new Date().toISOString();
  const results: ProbeEndpointResult[] = [];
  const observations: string[] = [];
  let totalRecordsRead = 0;
  const observedUserIds = new Set<string>();
  let hasThreadOrConversationId = false;

  // 1. Workspace members
  try {
    const users = await client.listUsers({ limit: 25 });
    totalRecordsRead += users.items.length;
    results.push({
      endpoint: "GET /users",
      status: "OK",
      itemCount: users.items.length,
      fieldKeys: collectKeys(users.items as Record<string, unknown>[]),
      hasNextCursor: Boolean(
        users.pagination?.nextCursor || users.pagination?.nextLink,
      ),
      notes: `Discovered ${users.items.length} workspace member record(s).`,
    });
  } catch (err) {
    const status = err instanceof FolkApiError ? err.status : 500;
    results.push({
      endpoint: "GET /users",
      status,
      itemCount: 0,
      fieldKeys: [],
      hasNextCursor: false,
      notes: err instanceof Error ? err.message : "Failed",
    });
  }

  // 2. Groups + singular custom fields (person + company)
  let firstGroupId: string | null = null;
  try {
    const groups = await client.listGroups({ limit: 25 });
    totalRecordsRead += groups.items.length;
    firstGroupId = groups.items[0]?.id ?? null;
    results.push({
      endpoint: "GET /groups",
      status: "OK",
      itemCount: groups.items.length,
      fieldKeys: collectKeys(groups.items as Record<string, unknown>[]),
      hasNextCursor: Boolean(
        groups.pagination?.nextCursor || groups.pagination?.nextLink,
      ),
      notes: `Group names: ${groups.items.map((g) => g.name).join(", ") || "(none)"}`,
    });
  } catch (err) {
    const status = err instanceof FolkApiError ? err.status : 500;
    results.push({
      endpoint: "GET /groups",
      status,
      itemCount: 0,
      fieldKeys: [],
      hasNextCursor: false,
      notes: err instanceof Error ? err.message : "Failed",
    });
  }

  if (firstGroupId) {
    for (const entityType of ["person", "company"] as const) {
      try {
        const fields = await client.listGroupCustomFields(
          firstGroupId,
          entityType,
        );
        totalRecordsRead += fields.items.length;
        results.push({
          endpoint: `GET /groups/${firstGroupId}/custom-fields/${entityType}`,
          status: "OK",
          itemCount: fields.items.length,
          fieldKeys: collectKeys(fields.items as Record<string, unknown>[]),
          hasNextCursor: false,
          notes: `Custom field definitions for '${entityType}' in first group.`,
        });
      } catch (err) {
        const status = err instanceof FolkApiError ? err.status : 500;
        results.push({
          endpoint: `GET /groups/${firstGroupId}/custom-fields/${entityType}`,
          status,
          itemCount: 0,
          fieldKeys: [],
          hasNextCursor: false,
          notes: err instanceof Error ? err.message : "Failed",
        });
      }
    }
  }

  // 3. People (read-only sample of 10 to pick up to 3 with interactionMetadata)
  let sampledPeople: FolkPerson[] = [];
  try {
    const people = await client.listPeople({ limit: 10 });
    totalRecordsRead += people.items.length;
    sampledPeople = people.items;
    results.push({
      endpoint: "GET /people?limit=10",
      status: "OK",
      itemCount: people.items.length,
      fieldKeys: collectKeys(people.items as Record<string, unknown>[]),
      hasNextCursor: Boolean(
        people.pagination?.nextCursor || people.pagination?.nextLink,
      ),
      notes: "Sampled structure only; PII omitted.",
    });
  } catch (err) {
    const status = err instanceof FolkApiError ? err.status : 500;
    results.push({
      endpoint: "GET /people?limit=10",
      status,
      itemCount: 0,
      fieldKeys: [],
      hasNextCursor: false,
      notes: err instanceof Error ? err.message : "Failed",
    });
  }

  // 4. Companies (read-only sample of 5)
  try {
    const companies = await client.listCompanies({ limit: 5 });
    totalRecordsRead += companies.items.length;
    results.push({
      endpoint: "GET /companies?limit=5",
      status: "OK",
      itemCount: companies.items.length,
      fieldKeys: collectKeys(companies.items as Record<string, unknown>[]),
      hasNextCursor: Boolean(
        companies.pagination?.nextCursor || companies.pagination?.nextLink,
      ),
      notes: "Sampled structure only.",
    });
  } catch (err) {
    const status = err instanceof FolkApiError ? err.status : 500;
    results.push({
      endpoint: "GET /companies?limit=5",
      status,
      itemCount: 0,
      fieldKeys: [],
      hasNextCursor: false,
      notes: err instanceof Error ? err.message : "Failed",
    });
  }

  // 5. Notes (read-only sample of 5)
  try {
    const notes = await client.listNotes({ limit: 5 });
    totalRecordsRead += notes.items.length;
    results.push({
      endpoint: "GET /notes?limit=5",
      status: "OK",
      itemCount: notes.items.length,
      fieldKeys: collectKeys(notes.items as Record<string, unknown>[]),
      hasNextCursor: Boolean(
        notes.pagination?.nextCursor || notes.pagination?.nextLink,
      ),
      notes: "Sampled structure only; note text omitted.",
    });
  } catch (err) {
    const status = err instanceof FolkApiError ? err.status : 500;
    results.push({
      endpoint: "GET /notes?limit=5",
      status,
      itemCount: 0,
      fieldKeys: [],
      hasNextCursor: false,
      notes: err instanceof Error ? err.message : "Failed",
    });
  }

  // 6. Entity-scoped Interactions across up to 3 sampled people
  const interactionCandidates = selectPeopleForInteractionProbe(sampledPeople);
  let interactionQueryParamStyle: "entity.id" | "filter[entity.id]" =
    "entity.id";
  const interactionItemsAll: Record<string, unknown>[] = [];
  let interactionQuerySucceeded = false;
  let interactionNextCursor = false;
  let lastInteractionError: { status: number | "OK"; notes: string } | null =
    null;

  for (const person of interactionCandidates) {
    try {
      const res = await client.listInteractions({
        entityId: person.id,
        timeframe: "past",
        limit: 10,
      });
      interactionQuerySucceeded = true;
      totalRecordsRead += res.items.length;
      if (res.pagination?.nextCursor || res.pagination?.nextLink) {
        interactionNextCursor = true;
      }
      for (const item of res.items) {
        interactionItemsAll.push(item as Record<string, unknown>);
        const uid = item.user?.id ?? item.userId;
        if (uid) observedUserIds.add(uid);
        if (item.threadId || item.conversationId) {
          hasThreadOrConversationId = true;
        }
      }
    } catch (err) {
      const status = err instanceof FolkApiError ? err.status : 500;
      if (status === 422 && !interactionQuerySucceeded) {
        // Fallback check using filter[entity.id] syntax
        try {
          const fallbackRes = await client.listInteractions({
            filterEntityId: person.id,
            timeframe: "past",
            limit: 10,
          });
          interactionQueryParamStyle = "filter[entity.id]";
          interactionQuerySucceeded = true;
          totalRecordsRead += fallbackRes.items.length;
          if (
            fallbackRes.pagination?.nextCursor ||
            fallbackRes.pagination?.nextLink
          ) {
            interactionNextCursor = true;
          }
          for (const item of fallbackRes.items) {
            interactionItemsAll.push(item as Record<string, unknown>);
            const uid = item.user?.id ?? item.userId;
            if (uid) observedUserIds.add(uid);
            if (item.threadId || item.conversationId) {
              hasThreadOrConversationId = true;
            }
          }
          continue;
        } catch (fallbackErr) {
          const fbStatus =
            fallbackErr instanceof FolkApiError ? fallbackErr.status : 500;
          lastInteractionError = {
            status: fbStatus,
            notes:
              fallbackErr instanceof Error ? fallbackErr.message : "Failed",
          };
          continue;
        }
      }
      lastInteractionError = {
        status,
        notes: err instanceof Error ? err.message : "Failed",
      };
    }
  }

  if (interactionCandidates.length === 0) {
    results.push({
      endpoint: "GET /interactions?entity.id={personId}&timeframe=past",
      status: 422,
      itemCount: 0,
      fieldKeys: [],
      hasNextCursor: false,
      notes: "No people returned from GET /people to scope interaction query.",
    });
  } else if (interactionQuerySucceeded) {
    results.push({
      endpoint: `GET /interactions?${interactionQueryParamStyle}={personId}&timeframe=past`,
      status: "OK",
      itemCount: interactionItemsAll.length,
      fieldKeys: collectKeys(interactionItemsAll),
      hasNextCursor: interactionNextCursor,
      notes: `Probed ${interactionCandidates.length} person record(s). Distinct user IDs: ${observedUserIds.size}; thread/conversation key: ${hasThreadOrConversationId ? "yes" : "not observed"}.`,
    });
  } else {
    results.push({
      endpoint: "GET /interactions?entity.id={personId}&timeframe=past",
      status: lastInteractionError?.status ?? 500,
      itemCount: 0,
      fieldKeys: [],
      hasNextCursor: false,
      notes: lastInteractionError?.notes ?? "Failed",
    });
  }

  // Email-filtered entity-scoped probe on the first candidate
  if (interactionCandidates[0]) {
    try {
      const emailParams =
        interactionQueryParamStyle === "filter[entity.id]"
          ? {
              filterEntityId: interactionCandidates[0].id,
              timeframe: "past" as const,
              importedTypes: "email",
              limit: 10,
            }
          : {
              entityId: interactionCandidates[0].id,
              timeframe: "past" as const,
              importedTypes: "email",
              limit: 10,
            };
      const emailInteractions = await client.listInteractions(emailParams);
      totalRecordsRead += emailInteractions.items.length;
      for (const item of emailInteractions.items) {
        const uid = item.user?.id ?? item.userId;
        if (uid) observedUserIds.add(uid);
        if (item.threadId || item.conversationId) {
          hasThreadOrConversationId = true;
        }
      }
      results.push({
        endpoint: `GET /interactions?${interactionQueryParamStyle}={personId}&importedTypes=email`,
        status: "OK",
        itemCount: emailInteractions.items.length,
        fieldKeys: collectKeys(
          emailInteractions.items as Record<string, unknown>[],
        ),
        hasNextCursor: Boolean(
          emailInteractions.pagination?.nextCursor ||
            emailInteractions.pagination?.nextLink,
        ),
        notes: "Email-filtered entity-scoped interaction query supported.",
      });
    } catch (err) {
      const status = err instanceof FolkApiError ? err.status : 500;
      results.push({
        endpoint: `GET /interactions?${interactionQueryParamStyle}={personId}&importedTypes=email`,
        status,
        itemCount: 0,
        fieldKeys: [],
        hasNextCursor: false,
        notes: err instanceof Error ? err.message : "Failed",
      });
    }
  }

  const distinctInteractionUserIds = Array.from(observedUserIds);
  if (interactionCandidates.length > 0) {
    observations.push(
      `Sampled interactions across ${interactionCandidates.length} person record(s) using query parameter '${interactionQueryParamStyle}'.`,
    );
    observations.push(
      `Distinct interaction user IDs observed in sample: ${distinctInteractionUserIds.length} (${distinctInteractionUserIds.join(", ") || "none"})`,
    );
    observations.push(
      `Thread/conversation ID field present on sampled interactions: ${hasThreadOrConversationId ? "yes" : "not observed"}`,
    );
  }

  const reportLines = [
    "# Phase 0 — Folk CRM Capability Report",
    "",
    `Generated: ${generatedAt}`,
    `Base URL: ${baseUrl}`,
    "Mode: Strictly read-only (GET only; PII and message bodies redacted)",
    "",
    "## Endpoint Probe Summary",
    "",
    "| Endpoint | Status | Items | Pagination Cursor | Notes |",
    "|---|---|---:|---|---|",
    ...results.map(
      (r) =>
        `| \`${r.endpoint}\` | ${r.status} | ${r.itemCount} | ${r.hasNextCursor ? "yes" : "no/single-page"} | ${r.notes} |`,
    ),
    "",
    "## Observed Field Keys",
    "",
    ...results.map(
      (r) =>
        `- **${r.endpoint}**: ${r.fieldKeys.length ? r.fieldKeys.map((k) => `\`${k}\``).join(", ") : "(none)"}`,
    ),
    "",
    "## Key Phase 0 Findings",
    "",
    ...(observations.length
      ? observations.map((o) => `- ${o}`)
      : ["- No interaction observations recorded."]),
    "",
  ];

  return {
    generatedAt,
    baseUrl,
    results,
    observations,
    totalRecordsRead,
    distinctInteractionUserIds,
    hasThreadOrConversationId,
    markdownReport: reportLines.join("\n"),
  };
}
