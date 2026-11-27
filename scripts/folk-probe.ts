/**
 * Phase 0 Read-Only Folk CRM API Probe (CLI entrypoint)
 *
 * Strictly executes GET requests only. Never writes to Folk, never logs the API key,
 * and redacts personal email addresses/bodies from the generated capability report.
 */
import fs from "node:fs";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { FolkRestClient } from "../src/lib/folk/client";
import { runFolkReadOnlyProbe } from "../src/lib/folk/probe";

loadDotenv({ path: ".env.local" });
loadDotenv();

async function main(): Promise<void> {
  const apiKey = process.env.FOLK_API_KEY?.trim();
  const baseUrl =
    process.env.FOLK_API_BASE_URL?.trim() || "https://api.folk.app/v1";

  if (!apiKey) {
    console.log("Phase 0 Folk Probe: FOLK_API_KEY is not set in .env.local.");
    console.log("Either:");
    console.log("  - Click 'Run Read-Only Folk API Probe' on the deployed Vercel app, or");
    console.log("  - Set FOLK_API_KEY=<your-key> in .env.local and re-run: npm run folk:probe");
    process.exit(0);
  }

  const client = new FolkRestClient({ apiKey, baseUrl });
  const report = await runFolkReadOnlyProbe(client, baseUrl);

  const reportPath = path.resolve(
    process.cwd(),
    "docs/phase-0-folk-capability-report.md",
  );
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, report.markdownReport, "utf8");

  console.log("\nPhase 0 Folk Probe Results (Read-Only):\n");
  console.table(
    report.results.map((r) => ({
      endpoint: r.endpoint,
      status: r.status,
      items: r.itemCount,
      nextCursor: r.hasNextCursor,
      notes: r.notes,
    })),
  );
  console.log(`\nWrote capability report to ${reportPath}`);
}

main().catch((err) => {
  console.error(
    "Phase 0 Folk probe encountered an unexpected error:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
