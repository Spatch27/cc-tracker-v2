import { createHash } from "node:crypto";

/**
 * Recursively sorts object keys so equivalent JSON structures always hash identically.
 */
export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  const entries = sortedKeys.map(
    (k) => `${JSON.stringify(k)}:${canonicalStringify(obj[k])}`,
  );
  return `{${entries.join(",")}}`;
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function computeProposalHash(input: {
  targetSystem: string;
  entityType: string;
  entityId: string;
  folkRecordId?: string | null;
  proposedChangesJson: Record<string, unknown>;
}): string {
  return sha256Hex(
    canonicalStringify({
      targetSystem: input.targetSystem,
      entityType: input.entityType,
      entityId: input.entityId,
      folkRecordId: input.folkRecordId ?? null,
      proposedChangesJson: input.proposedChangesJson,
    }),
  );
}

export function computeMessageContentHash(input: {
  senderUserId: string;
  recipientName: string;
  recipientAddress: string;
  channel: string;
  subject?: string | null;
  body: string;
}): string {
  return sha256Hex(
    canonicalStringify({
      senderUserId: input.senderUserId,
      recipientName: input.recipientName,
      recipientAddress: input.recipientAddress,
      channel: input.channel,
      subject: input.subject ?? null,
      body: input.body,
    }),
  );
}
