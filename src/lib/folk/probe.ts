import { FolkApiError } from "./client";
import type { FolkClientInterface } from "./types";

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
  let distinctInteractionUserIds: string[] = [];
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

  // 2. Groups + custom fields
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
    try {
      const fields = await client.listGroupCustomFields(firstGroupId);
      totalRecordsRead += fields.items.length;
      results.push({
        endpoint: `GET /groups/${firstGroupId}/custom-fields`,
        status: "OK",
        itemCount: fields.items.length,
        fieldKeys: collectKeys(fields.items as Record<string, unknown>[]),
        hasNextCursor: false,
        notes: "Custom field types visible for first group.",
      });
    } catch (err) {
      const status = err instanceof FolkApiError ? err.status : 500;
      results.push({
        endpoint: "GET /groups/{id}/custom-fields",
        status,
        itemCount: 0,
        fieldKeys: [],
        hasNextCursor: false,
        notes: err instanceof Error ? err.message : "Failed",
      });
    }
  }

  // 3. People (read-only sample of 5)
  try {
    const people = await client.listPeople({ limit: 5 });
    totalRecordsRead += people.items.length;
    results.push({
      endpoint: "GET /people?limit=5",
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
      endpoint: "GET /people?limit=5",
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

  // 6. Interactions (past + email filter)
  try {
    const interactions = await client.listInteractions({
      timeframe: "past",
      limit: 10,
    });
    totalRecordsRead += interactions.items.length;
    const observedUserIds = new Set<string>();
    for (const item of interactions.items) {
      const uid = item.user?.id ?? item.userId;
      if (uid) observedUserIds.add(uid);
      if (item.threadId || item.conversationId) {
        hasThreadOrConversationId = true;
      }
    }
    distinctInteractionUserIds = Array.from(observedUserIds);
    observations.push(
      `Distinct interaction user IDs observed in sample: ${distinctInteractionUserIds.length} (${distinctInteractionUserIds.join(", ") || "none"})`,
    );
    observations.push(
      `Thread/conversation ID field present on sampled interactions: ${hasThreadOrConversationId ? "yes" : "not observed"}`,
    );

    results.push({
      endpoint: "GET /interactions?timeframe=past&limit=10",
      status: "OK",
      itemCount: interactions.items.length,
      fieldKeys: collectKeys(interactions.items as Record<string, unknown>[]),
      hasNextCursor: Boolean(
        interactions.pagination?.nextCursor ||
          interactions.pagination?.nextLink,
      ),
      notes: `Distinct user IDs: ${distinctInteractionUserIds.length}; thread/conversation key: ${hasThreadOrConversationId ? "yes" : "not observed"}.`,
    });
  } catch (err) {
    const status = err instanceof FolkApiError ? err.status : 500;
    results.push({
      endpoint: "GET /interactions?timeframe=past&limit=10",
      status,
      itemCount: 0,
      fieldKeys: [],
      hasNextCursor: false,
      notes: err instanceof Error ? err.message : "Failed",
    });
  }

  try {
    const emailInteractions = await client.listInteractions({
      timeframe: "past",
      importedTypes: "email",
      limit: 10,
    });
    totalRecordsRead += emailInteractions.items.length;
    results.push({
      endpoint: "GET /interactions?timeframe=past&importedTypes=email&limit=10",
      status: "OK",
      itemCount: emailInteractions.items.length,
      fieldKeys: collectKeys(
        emailInteractions.items as Record<string, unknown>[],
      ),
      hasNextCursor: Boolean(
        emailInteractions.pagination?.nextCursor ||
          emailInteractions.pagination?.nextLink,
      ),
      notes: "Email-filtered interaction query supported.",
    });
  } catch (err) {
    const status = err instanceof FolkApiError ? err.status : 500;
    results.push({
      endpoint: "GET /interactions?timeframe=past&importedTypes=email&limit=10",
      status,
      itemCount: 0,
      fieldKeys: [],
      hasNextCursor: false,
      notes: err instanceof Error ? err.message : "Failed",
    });
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
