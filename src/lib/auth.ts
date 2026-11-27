import { eq } from "drizzle-orm";
import { getDb, isDatabaseConfigured, schema } from "@/db";
import { isClerkConfigured } from "./env";

export class AuthError extends Error {
  readonly status: 401 | 403;

  constructor(message: string, status: 401 | 403) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

export function parseAllowedEmails(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const unique = new Set<string>();
  for (const part of raw.split(",")) {
    const normalized = part.trim().toLowerCase();
    if (normalized.length > 0) {
      unique.add(normalized);
    }
  }
  return Array.from(unique);
}

/**
 * Fail-closed allowlist check. If allowlist is empty, every email is denied.
 */
export function isEmailAllowlisted(
  email: string | undefined | null,
  allowlist: readonly string[],
): boolean {
  if (!email || allowlist.length === 0) return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  return allowlist.some((allowed) => allowed.trim().toLowerCase() === normalized);
}

export interface FounderIdentity {
  userId: string | null;
  clerkUserId: string;
  email: string;
  name: string;
  role: "admin";
}

export type FounderAccessState =
  | { status: "unconfigured" }
  | { status: "unauthenticated" }
  | { status: "forbidden"; email: string | null }
  | { status: "authenticated"; founder: FounderIdentity };

async function syncFounderUserRecord(params: {
  clerkUserId: string;
  email: string;
  name: string;
}): Promise<string | null> {
  if (!isDatabaseConfigured()) return null;

  try {
    const db = getDb();
    const normalizedEmail = params.email.trim().toLowerCase();

    const existingByClerk = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.clerkUserId, params.clerkUserId))
      .limit(1);

    if (existingByClerk[0]) {
      const row = existingByClerk[0];
      if (row.email !== normalizedEmail || row.name !== params.name) {
        await db
          .update(schema.users)
          .set({
            email: normalizedEmail,
            name: params.name,
            updatedAt: new Date(),
          })
          .where(eq(schema.users.id, row.id));
      }
      return row.id;
    }

    const existingByEmail = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, normalizedEmail))
      .limit(1);

    if (existingByEmail[0]) {
      const row = existingByEmail[0];
      await db
        .update(schema.users)
        .set({
          clerkUserId: params.clerkUserId,
          name: params.name,
          updatedAt: new Date(),
        })
        .where(eq(schema.users.id, row.id));
      return row.id;
    }

    const [created] = await db
      .insert(schema.users)
      .values({
        clerkUserId: params.clerkUserId,
        email: normalizedEmail,
        name: params.name,
        role: "admin",
        isActive: true,
      })
      .returning({ id: schema.users.id });

    return created?.id ?? null;
  } catch (err) {
    console.error(
      "syncFounderUserRecord skipped:",
      err instanceof Error ? err.message : "Database unavailable",
    );
    return null;
  }
}

export async function getFounderAccessState(): Promise<FounderAccessState> {
  if (!isClerkConfigured()) {
    return { status: "unconfigured" };
  }

  const { auth, currentUser } = await import("@clerk/nextjs/server");
  const session = await auth();
  if (!session.userId) {
    return { status: "unauthenticated" };
  }

  const user = await currentUser();
  const primaryEmail =
    user?.primaryEmailAddress?.emailAddress ??
    user?.emailAddresses?.[0]?.emailAddress ??
    null;

  const allowlist = parseAllowedEmails(process.env.ALLOWED_FOUNDER_EMAILS);
  if (!isEmailAllowlisted(primaryEmail, allowlist)) {
    return { status: "forbidden", email: primaryEmail };
  }

  const displayName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() ||
    user?.username ||
    primaryEmail!;

  const dbUserId = await syncFounderUserRecord({
    clerkUserId: session.userId,
    email: primaryEmail!,
    name: displayName,
  });

  return {
    status: "authenticated",
    founder: {
      userId: dbUserId,
      clerkUserId: session.userId,
      email: primaryEmail!.trim().toLowerCase(),
      name: displayName,
      role: "admin",
    },
  };
}

export async function requireFounderSession(): Promise<FounderIdentity> {
  const state = await getFounderAccessState();
  if (state.status === "unconfigured") {
    throw new AuthError("Clerk authentication is not configured", 401);
  }
  if (state.status === "unauthenticated") {
    throw new AuthError("Authentication required", 401);
  }
  if (state.status === "forbidden") {
    throw new AuthError("Account is not on the founder allowlist", 403);
  }
  return state.founder;
}
