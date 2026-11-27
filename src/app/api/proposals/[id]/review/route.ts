import { z } from "zod";
import { isDatabaseConfigured } from "@/db";
import { errorResponse } from "@/lib/api-auth";
import { requireFounderSession } from "@/lib/auth";
import { createFolkClientFromEnv } from "@/lib/folk/client";
import { recordAuditEvent } from "@/lib/governance/audit";
import {
  ApprovalRequiredError,
  ApprovalStaleError,
  createDrizzleProposalStore,
  ForbiddenGovernanceActionError,
  ProposalGovernanceService,
} from "@/lib/governance/proposals";

export const dynamic = "force-dynamic";

const reviewSchema = z.object({
  decision: z.enum(["approve", "reject", "approve_and_apply"]),
  expectedPayloadHash: z.string().optional(),
  reviewNote: z.string().nullable().optional(),
  idempotencyKey: z.string().optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const founder = await requireFounderSession();
    if (!founder.userId || !isDatabaseConfigured()) {
      return Response.json(
        { error: "Database is not configured" },
        { status: 503 },
      );
    }

    const { id } = await context.params;
    const body = reviewSchema.parse(await request.json());
    const service = new ProposalGovernanceService(createDrizzleProposalStore());

    if (body.decision === "reject") {
      const proposal = await service.rejectProposal({
        proposalId: id,
        reviewerUserId: founder.userId,
        actorType: "human",
        reviewNote: body.reviewNote ?? null,
      });

      await recordAuditEvent({
        actorType: "human",
        actorUserId: founder.userId,
        action: "proposal_rejected",
        entityType: "change_proposal",
        entityId: proposal.id,
        outcome: "succeeded",
      });

      return Response.json({ proposal });
    }

    const approved = await service.approveProposal({
      proposalId: id,
      approverUserId: founder.userId,
      actorType: "human",
      expectedPayloadHash: body.expectedPayloadHash,
      reviewNote: body.reviewNote ?? null,
    });

    await recordAuditEvent({
      actorType: "human",
      actorUserId: founder.userId,
      action: "proposal_approved",
      entityType: "change_proposal",
      entityId: approved.id,
      outcome: "succeeded",
    });

    if (body.decision === "approve") {
      return Response.json({ proposal: approved });
    }

    const folkClient = createFolkClientFromEnv();
    if (!folkClient && approved.targetSystem === "folk") {
      return Response.json(
        {
          proposal: approved,
          error: "Proposal approved, but FOLK_API_KEY is not configured to apply",
        },
        { status: 503 },
      );
    }

    const result = await service.applyApprovedProposal({
      proposalId: approved.id,
      folkClient: folkClient!,
      idempotencyKey: body.idempotencyKey,
    });

    await recordAuditEvent({
      actorType: "human",
      actorUserId: founder.userId,
      action:
        result.outcome === "conflict"
          ? "proposal_apply_conflict"
          : "proposal_applied",
      entityType: "change_proposal",
      entityId: result.proposal.id,
      outcome: result.outcome === "conflict" ? "failed" : "succeeded",
      metadata: result.conflicts ? { conflicts: result.conflicts } : null,
    });

    return Response.json(result, {
      status: result.outcome === "conflict" ? 409 : 200,
    });
  } catch (err) {
    if (
      err instanceof ApprovalRequiredError ||
      err instanceof ApprovalStaleError
    ) {
      return Response.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof ForbiddenGovernanceActionError) {
      return Response.json({ error: err.message }, { status: 403 });
    }
    return errorResponse(err);
  }
}
