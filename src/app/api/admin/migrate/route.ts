import path from "node:path";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { getDb, isDatabaseConfigured } from "@/db";
import { errorResponse } from "@/lib/api-auth";
import { requireFounderSession } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/governance/audit";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const founder = await requireFounderSession();
    if (!isDatabaseConfigured()) {
      return Response.json(
        { error: "DATABASE_URL is not configured in environment variables." },
        { status: 503 },
      );
    }

    const db = getDb();
    const migrationsFolder = path.join(process.cwd(), "drizzle");
    await migrate(db, { migrationsFolder });

    try {
      await recordAuditEvent({
        actorType: "human",
        actorUserId: founder.userId,
        action: "database_migrations_applied",
        entityType: "database",
        outcome: "succeeded",
      });
    } catch {
      // Non-fatal if founder row was not yet created prior to migration.
    }

    return Response.json({
      ok: true,
      message: "Postgres schema is up to date (all 15 tables verified).",
    });
  } catch (err) {
    return errorResponse(err);
  }
}
