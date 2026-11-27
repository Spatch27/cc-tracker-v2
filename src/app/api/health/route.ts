import { sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/db";
import { getIntegrationStatus } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = getIntegrationStatus();
  let databaseReachable = false;

  if (isDatabaseConfigured()) {
    try {
      const db = getDb();
      await db.execute(sql`SELECT 1`);
      databaseReachable = true;
    } catch {
      databaseReachable = false;
    }
  }

  return Response.json({
    ok: true,
    integrations: status,
    databaseReachable,
    timestamp: new Date().toISOString(),
  });
}
