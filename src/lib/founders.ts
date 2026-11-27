import { asc, eq } from "drizzle-orm";
import type { AppDatabase } from "@/db";
import { schema } from "@/db";
import { parseAllowedEmails } from "@/lib/auth";

export interface FounderOption {
  id: string;
  email: string;
  name: string;
}

function formatDefaultFounderName(email: string): string {
  const local = email.split("@")[0] ?? "Founder";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Ensures every email in ALLOWED_FOUNDER_EMAILS has a user record so both Tim
 * and Ben can be selected as hosts or logistics owners immediately.
 */
export async function ensureAllowlistedFounders(
  db: AppDatabase,
): Promise<FounderOption[]> {
  const allowlisted = parseAllowedEmails(process.env.ALLOWED_FOUNDER_EMAILS);
  for (const email of allowlisted) {
    await db
      .insert(schema.users)
      .values({
        email,
        name: formatDefaultFounderName(email),
        role: "admin",
        isActive: true,
      })
      .onConflictDoNothing({ target: schema.users.email });
  }

  const rows = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
    })
    .from(schema.users)
    .where(eq(schema.users.isActive, true))
    .orderBy(asc(schema.users.email));

  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name ?? formatDefaultFounderName(r.email),
  }));
}
