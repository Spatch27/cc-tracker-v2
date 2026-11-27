import { desc } from "drizzle-orm";
import { z } from "zod";
import { getDb, isDatabaseConfigured, schema } from "@/db";
import { authenticateFounderOrAgent, errorResponse } from "@/lib/api-auth";
import { recordAuditEvent } from "@/lib/governance/audit";
import {
  createDrizzleProposalStore,
  ProposalGovernanceService,
} from "@/lib/governance/proposals";

export const dynamic = "force-dynamic";

const createProposalSchema = z.object({
  targetSystem: z.enum(["folk", "tracker"]),
  entityType: z.enum(["person", "company", "gold_account", "breakfast_event"]),
  entityId: z.string().min(1),
  folkRecordId: z.string().nullable().optional(),
  summary: z.string().min(1),
  proposedChangesJson: z.record(z.unknown()),
  baseSnapshotJson: z.record(z.unknown()).default({}),
  sourceUrl: z.string().nullable().optional(),
  sourceNote: z.string().nullable().optional(),
  factType: z.enum(["verified", "interpretation", "unknown"]).optional(),
  evidenceDate: z.string().datetime().nullable().optional(),
  idempotencyKey: z.string().nullable().optional(),
});

export async function GET(request: Request) {
  try {
    await authenticateFounderOrAgent(request, "read:context");
    if (!isDatabaseConfigured()) {
      return Response.json({ proposals: [], databaseConfigured: false });
    }
    const db = getDb();
    const proposals = await db
      .select()
      .from(schema.changeProposals)
      .orderBy(desc(schema.changeProposals.createdAt))
      .limit(100);
    return Response.json({ proposals });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await authenticateFounderOrAgent(request, "propose:research");
    if (!isDatabaseConfigured()) {
      return Response.json(
        { error: "Database is not configured" },
        { status: 503 },
      );
    }

    const body = createProposalSchema.parse(await request.json());
    const service = new ProposalGovernanceService(createDrizzleProposalStore());

    const proposal = await service.createProposal({
      targetSystem: body.targetSystem,
      entityType: body.entityType,
      entityId: body.entityId,
      folkRecordId: body.folkRecordId ?? null,
      proposedByAgentId: actor.kind === "agent" ? actor.agent.id : null,
      proposedByUserId: actor.kind === "human" ? actor.founder.userId : null,
      summary: body.summary,
      proposedChangesJson: body.proposedChangesJson,
      baseSnapshotJson: body.baseSnapshotJson,
      sourceUrl: body.sourceUrl ?? null,
      sourceNote: body.sourceNote ?? null,
      factType: body.factType ?? "verified",
      evidenceDate: body.evidenceDate ? new Date(body.evidenceDate) : null,
      idempotencyKey: body.idempotencyKey ?? null,
    });

    await recordAuditEvent({
      actorType: actor.kind,
      actorUserId: actor.kind === "human" ? actor.founder.userId : null,
      actorAgentId: actor.kind === "agent" ? actor.agent.id : null,
      action: "proposal_created",
      entityType: "change_proposal",
      entityId: proposal.id,
      newValue: proposal.proposedChangesJson,
      source: body.sourceUrl ?? body.sourceNote ?? null,
      evidenceDate: proposal.evidenceDate,
      outcome: "succeeded",
    });

    return Response.json({ proposal }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
