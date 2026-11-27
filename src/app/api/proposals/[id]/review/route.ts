import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, isDatabaseConfigured, schema } from "@/db";
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
  type ApplyProposalResult,
  type ChangeProposalRecord,
} from "@/lib/governance/proposals";

export const dynamic = "force-dynamic";

const reviewSchema = z.object({
  decision: z.enum([
    "approve",
    "reject",
    "approve_and_apply",
    "apply",
    "resolve_conflict_apply",
    "accept_live_folk_to_tracker",
  ]),
  expectedPayloadHash: z.string().optional(),
  reviewNote: z.string().nullable().optional(),
  idempotencyKey: z.string().optional(),
  resolvedChangesJson: z.record(z.unknown()).optional(),
  refreshedBaseSnapshotJson: z.record(z.unknown()).optional(),
});

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function syncCreatedFolkPersonToTracker(params: {
  proposal: ChangeProposalRecord;
  createdFolkId: string;
  founderUserId: string;
}) {
  const db = getDb();
  const changes = params.proposal.proposedChangesJson;
  const fullName =
    typeof changes.fullName === "string" && changes.fullName.trim()
      ? changes.fullName.trim()
      : [changes.firstName, changes.lastName]
          .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
          .join(" ")
          .trim() || "Unknown";

  const email =
    Array.isArray(changes.emails) && typeof changes.emails[0] === "string"
      ? changes.emails[0]
      : null;
  const jobTitle =
    typeof changes.jobTitle === "string" ? changes.jobTitle : null;
  const linkedinUrl = Array.isArray(changes.urls)
    ? changes.urls.find(
        (u): u is string =>
          typeof u === "string" && u.toLowerCase().includes("linkedin.com"),
      ) ?? null
    : null;

  const [personLink] = await db
    .insert(schema.folkPeopleLink)
    .values({
      folkPersonId: params.createdFolkId,
      fullName,
      email,
      jobTitle,
      linkedinUrl,
      lastSyncedAt: new Date(),
      syncStatus: "linked",
    })
    .onConflictDoUpdate({
      target: schema.folkPeopleLink.folkPersonId,
      set: {
        fullName,
        email,
        jobTitle,
        linkedinUrl,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      },
    })
    .returning();

  const targetEventId =
    typeof changes._targetBreakfastEventId === "string" &&
    UUID_REGEX.test(changes._targetBreakfastEventId)
      ? changes._targetBreakfastEventId
      : null;

  if (targetEventId && personLink && !personLink.contactSuppressed) {
    const [insertedInvite] = await db
      .insert(schema.breakfastInvitations)
      .values({
        eventId: targetEventId,
        folkPersonLinkId: personLink.id,
        responseStatus: "provisional",
        attendanceOutcome: "pending",
        waitlistStatus: "none",
        chaseStatus: "none",
      })
      .onConflictDoNothing()
      .returning();

    if (insertedInvite) {
      await db.insert(schema.breakfastInvitationHistory).values({
        invitationId: insertedInvite.id,
        changedByUserId: params.founderUserId,
        previousResponseStatus: null,
        newResponseStatus: insertedInvite.responseStatus,
        previousAttendanceOutcome: null,
        newAttendanceOutcome: insertedInvite.attendanceOutcome,
        previousWaitlistStatus: null,
        newWaitlistStatus: insertedInvite.waitlistStatus,
        note: "Added from approved Folk contact creation proposal",
      });
    }
  }
}

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
    const store = createDrizzleProposalStore();
    const service = new ProposalGovernanceService(store);

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

    if (body.decision === "accept_live_folk_to_tracker") {
      const existing = await store.getById(id);
      if (!existing) {
        return Response.json({ error: "Proposal not found" }, { status: 404 });
      }
      if (existing.targetSystem !== "tracker") {
        return Response.json(
          { error: "Only tracker reconciliation proposals can update Tracker links directly" },
          { status: 400 },
        );
      }

      const approved = await service.approveProposal({
        proposalId: id,
        approverUserId: founder.userId,
        actorType: "human",
        expectedPayloadHash: body.expectedPayloadHash,
        reviewNote: body.reviewNote ?? "Accepted live Folk values into Tracker",
      });

      const db = getDb();
      const changes = approved.proposedChangesJson;
      if (approved.entityType === "person") {
        const updateSet: Partial<typeof schema.folkPeopleLink.$inferInsert> = {
          lastSyncedAt: new Date(),
          syncStatus: "linked",
          updatedAt: new Date(),
        };
        if (typeof changes.fullName === "string") updateSet.fullName = changes.fullName;
        if ("email" in changes) updateSet.email = typeof changes.email === "string" ? changes.email : null;
        if ("jobTitle" in changes) updateSet.jobTitle = typeof changes.jobTitle === "string" ? changes.jobTitle : null;
        if ("linkedinUrl" in changes) {
          updateSet.linkedinUrl = typeof changes.linkedinUrl === "string" ? changes.linkedinUrl : null;
        }
        await db
          .update(schema.folkPeopleLink)
          .set(updateSet)
          .where(
            UUID_REGEX.test(approved.entityId)
              ? eq(schema.folkPeopleLink.id, approved.entityId)
              : eq(schema.folkPeopleLink.folkPersonId, approved.folkRecordId ?? approved.entityId),
          );
      } else if (approved.entityType === "company") {
        const updateSet: Partial<typeof schema.folkCompaniesLink.$inferInsert> = {
          lastSyncedAt: new Date(),
          syncStatus: "linked",
          updatedAt: new Date(),
        };
        if (typeof changes.name === "string") updateSet.name = changes.name;
        if ("domain" in changes) updateSet.domain = typeof changes.domain === "string" ? changes.domain : null;
        await db
          .update(schema.folkCompaniesLink)
          .set(updateSet)
          .where(
            UUID_REGEX.test(approved.entityId)
              ? eq(schema.folkCompaniesLink.id, approved.entityId)
              : eq(schema.folkCompaniesLink.folkCompanyId, approved.folkRecordId ?? approved.entityId),
          );
      }

      const applied = await store.update(approved.id, {
        status: "applied",
        appliedAt: new Date(),
        applyError: null,
      });

      await recordAuditEvent({
        actorType: "human",
        actorUserId: founder.userId,
        action: "reconciliation_conflict_accepted_to_tracker",
        entityType: "change_proposal",
        entityId: applied.id,
        previousValue: approved.baseSnapshotJson,
        newValue: approved.proposedChangesJson,
        outcome: "succeeded",
      });

      return Response.json({ proposal: applied, outcome: "applied" });
    }

    if (body.decision === "resolve_conflict_apply") {
      const folkClient = createFolkClientFromEnv();
      const target = await store.getById(id);
      if (!target) {
        return Response.json({ error: "Proposal not found" }, { status: 404 });
      }
      if (!folkClient && target.targetSystem === "folk") {
        return Response.json(
          { error: "FOLK_API_KEY is not configured to apply conflict resolution" },
          { status: 503 },
        );
      }

      const resolvedChanges =
        body.resolvedChangesJson ?? target.proposedChangesJson;
      const refreshedBase =
        body.refreshedBaseSnapshotJson ?? target.baseSnapshotJson;

      const result = await service.resolveConflictAndApply({
        proposalId: id,
        approverUserId: founder.userId,
        actorType: "human",
        resolvedChangesJson: resolvedChanges,
        refreshedBaseSnapshotJson: refreshedBase,
        folkClient: folkClient!,
        reviewNote: body.reviewNote ?? null,
        idempotencyKey: body.idempotencyKey,
      });

      if (result.outcome === "applied" && result.createdFolkId) {
        await syncCreatedFolkPersonToTracker({
          proposal: result.proposal,
          createdFolkId: result.createdFolkId,
          founderUserId: founder.userId,
        });
      }

      await recordAuditEvent({
        actorType: "human",
        actorUserId: founder.userId,
        action:
          result.outcome === "conflict"
            ? "proposal_conflict_persisted"
            : "proposal_conflict_resolved_applied",
        entityType: "change_proposal",
        entityId: result.proposal.id,
        newValue: result.proposal.proposedChangesJson,
        outcome: result.outcome === "conflict" ? "failed" : "succeeded",
        metadata: result.conflicts ? { conflicts: result.conflicts } : null,
      });

      return Response.json(result, {
        status: result.outcome === "conflict" ? 409 : 200,
      });
    }

    let approved: ChangeProposalRecord;
    if (body.decision === "apply") {
      const existing = await store.getById(id);
      if (!existing) {
        return Response.json({ error: "Proposal not found" }, { status: 404 });
      }
      approved = existing;
    } else {
      approved = await service.approveProposal({
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

    const result: ApplyProposalResult = await service.applyApprovedProposal({
      proposalId: approved.id,
      folkClient: folkClient!,
      idempotencyKey: body.idempotencyKey,
    });

    if (result.outcome === "applied" && result.createdFolkId) {
      await syncCreatedFolkPersonToTracker({
        proposal: result.proposal,
        createdFolkId: result.createdFolkId,
        founderUserId: founder.userId,
      });
    }

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
      metadata: {
        ...(result.conflicts ? { conflicts: result.conflicts } : {}),
        ...(result.createdFolkId ? { createdFolkId: result.createdFolkId } : {}),
      },
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
