import { getDb, isDatabaseConfigured, schema } from "@/db";

const SENSITIVE_KEY_PATTERN = /token|secret|password|apikey|api_key|authorization|cookie/i;

export function sanitizeForAudit<T>(value: T): T {
  if (value === null || value === undefined || typeof value !== "object") {
    return value;
  }
  if (value instanceof Date) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForAudit(item)) as unknown as T;
  }

  const source = value as Record<string, unknown>;
  const cleaned: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(source)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      cleaned[key] = "[REDACTED]";
    } else {
      cleaned[key] = sanitizeForAudit(val);
    }
  }
  return cleaned as T;
}

export interface AuditEventInput {
  actorType: "human" | "agent" | "system";
  actorUserId?: string | null;
  actorAgentId?: string | null;
  initiatingUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  fieldName?: string | null;
  previousValue?: unknown;
  newValue?: unknown;
  source?: string | null;
  evidenceDate?: Date | null;
  outcome: "succeeded" | "denied" | "failed" | "pending";
  metadata?: Record<string, unknown> | null;
}

export function buildAuditEvent(input: AuditEventInput) {
  return {
    actorType: input.actorType,
    actorUserId: input.actorUserId ?? null,
    actorAgentId: input.actorAgentId ?? null,
    initiatingUserId: input.initiatingUserId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    fieldName: input.fieldName ?? null,
    previousValueJson:
      input.previousValue !== undefined ? sanitizeForAudit(input.previousValue) : null,
    newValueJson:
      input.newValue !== undefined ? sanitizeForAudit(input.newValue) : null,
    source: input.source ?? null,
    evidenceDate: input.evidenceDate ?? null,
    outcome: input.outcome,
    metadataJson: input.metadata ? sanitizeForAudit(input.metadata) : null,
  };
}

export async function recordAuditEvent(input: AuditEventInput): Promise<void> {
  if (!isDatabaseConfigured()) return;
  const db = getDb();
  await db.insert(schema.auditEvents).values(buildAuditEvent(input));
}
