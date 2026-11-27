import { z } from "zod";
import { isDatabaseConfigured } from "@/db";
import { authenticateFounderOrAgent, errorResponse } from "@/lib/api-auth";
import { requireFounderSession } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/governance/audit";
import {
  createDrizzleProposalStore,
  ProposalGovernanceService,
} from "@/lib/governance/proposals";

export const dynamic = "force-dynamic";

const editProposalSchema = z.object({
  summary: z.string().min(1).optional(),
  proposedChangesJson: z.record(z.unknown()).optional(),
  sourceUrl: z.string().nullable().optional(),
  sourceNote: z.string().nullable().optional(),
});

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await authenticateFounderOrAgent(request, "read:context");
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

    return Response.json({ proposal });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const founder = await requireFounderSession();
    if (!isDatabaseConfigured()) {
      return Response.json(
        { error: "Database is not configured" },
        { status: 503 },
      );
    }

    const { id } = await context.params;
    const body = editProposalSchema.parse(await request.json());
    const service = new ProposalGovernanceService(createDrizzleProposalStore());

    const proposal = await service.editProposal(id, {
      summary: body.summary,
      proposedChangesJson: body.proposedChangesJson,
      sourceUrl: body.sourceUrl,
      sourceNote: body.sourceNote,
    });

    await recordAuditEvent({
      actorType: "human",
      actorUserId: founder.userId,
      action: "proposal_edited",
      entityType: "change_proposal",
      entityId: proposal.id,
      newValue: proposal.proposedChangesJson,
      outcome: "succeeded",
    });

    return Response.json({ proposal });
  } catch (err) {
    return errorResponse(err);
  }
}
