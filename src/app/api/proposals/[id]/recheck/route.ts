import { isDatabaseConfigured } from "@/db";
import { errorResponse } from "@/lib/api-auth";
import { requireFounderSession } from "@/lib/auth";
import { createFolkClientFromEnv } from "@/lib/folk/client";
import {
  createDrizzleProposalStore,
  detectFolkFieldConflicts,
  stripInternalProposalKeys,
} from "@/lib/governance/proposals";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireFounderSession();
    if (!isDatabaseConfigured()) {
      return Response.json(
        { error: "Database is not configured" },
        { status: 503 },
      );
    }

    const { id } = await context.params;
    const store = createDrizzleProposalStore();
    const proposal = await store.getById(id);
    if (!proposal) {
      return Response.json({ error: "Proposal not found" }, { status: 404 });
    }

    const folkClient = createFolkClientFromEnv();
    if (!folkClient) {
      return Response.json(
        { error: "FOLK_API_KEY is not configured" },
        { status: 503 },
      );
    }

    if (!proposal.folkRecordId) {
      return Response.json({
        liveRecord: null,
        baseSnapshot: proposal.baseSnapshotJson,
        proposedChanges: proposal.proposedChangesJson,
        conflicts: [],
        note: "No existing folkRecordId attached (new Folk record proposal).",
      });
    }

    let liveRecord: Record<string, unknown>;
    if (proposal.entityType === "company") {
      liveRecord = (await folkClient.getCompany(
        proposal.folkRecordId,
      )) as unknown as Record<string, unknown>;
    } else {
      liveRecord = (await folkClient.getPerson(
        proposal.folkRecordId,
      )) as unknown as Record<string, unknown>;
    }

    const conflicts = detectFolkFieldConflicts({
      proposedChanges: stripInternalProposalKeys(proposal.proposedChangesJson),
      baseSnapshot: proposal.baseSnapshotJson,
      liveRecord,
    });

    return Response.json({
      liveRecord,
      baseSnapshot: proposal.baseSnapshotJson,
      proposedChanges: proposal.proposedChangesJson,
      conflicts,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
