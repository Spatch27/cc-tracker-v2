/**
 * Phase 0 Read-Only Folk CRM API Probe
 *
 * Strictly executes GET requests only. Never writes to Folk, never logs the API key,
 * and redacts personal email addresses/bodies from the generated capability report.
 */
import fs from "node:fs";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { FolkApiError, FolkRestClient } from "../src/lib/folk/client";

loadDotenv({ path: ".env.local" });
loadDotenv();

interface ProbeEndpointResult {
  endpoint: string;
  status: number | "OK";
  itemCount: number;
  fieldKeys: string[];
  hasNextCursor: boolean;
  notes: string;
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

async function runProbe(): Promise<void> {
  const apiKey = process.env.FOLK_API_KEY?.trim();
  const baseUrl = process.env.FOLK_API_BASE_URL?.trim() || "https://api.folk.app/v1";

  if (!apiKey) {
    console.log("Phase 0 Folk Probe: FOLK_API_KEY is not set in .env.local.");
    console.log("To run this read-only probe:");
    console.log("  1. Copy .env.example to .env.local");
    console.log("  2. Generate a Folk API key in app.folk.app -> Settings -> API");
    console.log("  3. Set FOLK_API_KEY=<your-key> in .env.local (never commit it)");
    console.log("  4. Re-run: npm run folk:probe");
    process.exit(0);
  }

  const client = new FolkRestClient({ apiKey, baseUrl });
  const results: ProbeEndpointResult[] = [];
  const observations: string[] = [];

  // 1. Users (to map workspace member IDs for Tim & Ben)
  try {
    const users = await client.listUsers({ limit: 25 });
    results.push({
      endpoint: "GET /users",
      status: "OK",
      itemCount: users.items.length,
      fieldKeys: collectKeys(users.items as Record<string, unknown>[]),
      hasNextCursor: Boolean(users.pagination?.nextCursor || users.pagination?.nextLink),
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

  // 2. Groups + Custom Fields
  let firstGroupId: string | null = null;
  try {
    const groups = await client.listGroups({ limit: 25 });
    firstGroupId = groups.items[0]?.id ?? null;
    results.push({
      endpoint: "GET /groups",
      status: "OK",
      itemCount: groups.items.length,
      fieldKeys: collectKeys(groups.items as Record<string, unknown>[]),
      hasNextCursor: Boolean(groups.pagination?.nextCursor || groups.pagination?.nextLink),
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
      results.push({
        endpoint: `GET /groups/${firstGroupId}/custom-fields`,
        status: "OK",
        itemCount: fields.items.length,
        fieldKeys: collectKeys(fields.items as Record<string, unknown>[]),
        hasNextCursor: false,
        notes: `Custom field types visible for first group.`,
      });
    } catch (err) {
      const status = err instanceof FolkApiError ? err.status : 500;
      results.push({
        endpoint: `GET /groups/{id}/custom-fields`,
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
    results.push({
      endpoint: "GET /people?limit=5",
      status: "OK",
      itemCount: people.items.length,
      fieldKeys: collectKeys(people.items as Record<string, unknown>[]),
      hasNextCursor: Boolean(people.pagination?.nextCursor || people.pagination?.nextLink),
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
    results.push({
      endpoint: "GET /notes?limit=5",
      status: "OK",
      itemCount: notes.items.length,
      fieldKeys: collectKeys(notes.items as Record<string, unknown>[]),
      hasNextCursor: Boolean(notes.pagination?.nextCursor || notes.pagination?.nextLink),
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
    const observedUserIds = new Set<string>();
    let hasThreadId = false;
    for (const item of interactions.items) {
      const uid = item.user?.id ?? item.userId;
      if (uid) observedUserIds.add(uid);
      if (item.threadId || item.conversationId) hasThreadId = true;
    }
    observations.push(
      `Distinct interaction user IDs observed in sample: ${observedUserIds.size} (${Array.from(observedUserIds).join(", ") || "none"})`,
    );
    observations.push(
      `Thread/conversation ID field present on sampled interactions: ${hasThreadId ? "yes" : "not observed"}`,
    );

    results.push({
      endpoint: "GET /interactions?timeframe=past&limit=10",
      status: "OK",
      itemCount: interactions.items.length,
      fieldKeys: collectKeys(interactions.items as Record<string, unknown>[]),
      hasNextCursor: Boolean(
        interactions.pagination?.nextCursor || interactions.pagination?.nextLink,
      ),
      notes: `Distinct user IDs: ${observedUserIds.size}; thread/conversation key: ${hasThreadId ? "yes" : "not observed"}.`,
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
    results.push({
      endpoint: "GET /interactions?timeframe=past&importedTypes=email&limit=10",
      status: "OK",
      itemCount: emailInteractions.items.length,
      fieldKeys: collectKeys(emailInteractions.items as Record<string, unknown>[]),
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
    `Generated: ${new Date().toISOString()}`,
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
      (r) => `- **${r.endpoint}**: ${r.fieldKeys.length ? r.fieldKeys.map((k) => `\`${k}\``).join(", ") : "(none)"}`,
    ),
    "",
    "## Key Phase 0 Findings",
    "",
    ...(observations.length
      ? observations.map((o) => `- ${o}`)
      : ["- No interaction observations recorded."]),
    "",
  ];

  const reportPath = path.resolve(
    process.cwd(),
    "docs/phase-0-folk-capability-report.md",
  );
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, reportLines.join("\n"), "utf8");

  console.log("\nPhase 0 Folk Probe Results (Read-Only):\n");
  console.table(
    results.map((r) => ({
      endpoint: r.endpoint,
      status: r.status,
      items: r.itemCount,
      nextCursor: r.hasNextCursor,
      notes: r.notes,
    })),
  );
  console.log(`\nWrote capability report to ${reportPath}`);
}

runProbe().catch((err) => {
  console.error("Phase 0 Folk probe encountered an unexpected error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
