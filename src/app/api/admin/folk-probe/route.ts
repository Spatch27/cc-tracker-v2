import { getDb, isDatabaseConfigured, schema } from "@/db";
import { errorResponse } from "@/lib/api-auth";
import { requireFounderSession } from "@/lib/auth";
import { createFolkClientFromEnv } from "@/lib/folk/client";
import { runFolkReadOnlyProbe } from "@/lib/folk/probe";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await requireFounderSession();

    const client = createFolkClientFromEnv();
    if (!client) {
      return Response.json(
        {
          error:
            "FOLK_API_KEY is not configured in Vercel environment variables.",
        },
        { status: 400 },
      );
    }

    const baseUrl =
      process.env.FOLK_API_BASE_URL?.trim() || "https://api.folk.app/v1";
    const startedAt = new Date();
    const report = await runFolkReadOnlyProbe(client, baseUrl);
    const finishedAt = new Date();

    const failures = report.results.filter((r) => r.status !== "OK");
    const status =
      failures.length === 0
        ? "succeeded"
        : failures.length < report.results.length
          ? "partial"
          : "failed";

    if (isDatabaseConfigured()) {
      try {
        const db = getDb();
        await db.insert(schema.syncRuns).values({
          source: "folk_rest",
          scope: "phase0_probe",
          status,
          recordsRead: report.totalRecordsRead,
          visibilityGapNote: `Distinct interaction users seen: ${report.distinctInteractionUserIds.length}; thread/conversation key: ${report.hasThreadOrConversationId ? "yes" : "not observed"}`,
          errorSummary:
            failures.length > 0
              ? failures.map((f) => `${f.endpoint}: ${f.status}`).join("; ")
              : null,
          startedAt,
          finishedAt,
        });
      } catch {
        // Allow probe to succeed even before DB migrations are applied.
      }
    }

    return Response.json({ ok: true, report });
  } catch (err) {
    return errorResponse(err);
  }
}
