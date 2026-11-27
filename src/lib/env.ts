export interface IntegrationStatus {
  databaseConfigured: boolean;
  clerkConfigured: boolean;
  folkConfigured: boolean;
  allowlistConfigured: boolean;
  allowlistCount: number;
}

export function isClerkConfigured(): boolean {
  const pub = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();
  const sec = process.env.CLERK_SECRET_KEY?.trim();
  return Boolean(pub && sec);
}

export function getAllowedFounderEmailsRaw(): string {
  return process.env.ALLOWED_FOUNDER_EMAILS ?? "";
}

export function getIntegrationStatus(): IntegrationStatus {
  const allowlist = getAllowedFounderEmailsRaw()
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  return {
    databaseConfigured: Boolean(process.env.DATABASE_URL?.trim()),
    clerkConfigured: isClerkConfigured(),
    folkConfigured: Boolean(process.env.FOLK_API_KEY?.trim()),
    allowlistConfigured: allowlist.length > 0,
    allowlistCount: allowlist.length,
  };
}
