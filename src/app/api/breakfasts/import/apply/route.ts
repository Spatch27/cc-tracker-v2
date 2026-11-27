import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, isDatabaseConfigured, schema } from "@/db";
import { errorResponse } from "@/lib/api-auth";
import { requireFounderSession } from "@/lib/auth";
import { normalizePersonName } from "@/lib/breakfasts/import-parser";
import { recordAuditEvent } from "@/lib/governance/audit";
import { canonicalStringify, sha256Hex } from "@/lib/governance/hashing";
import {
  createDrizzleProposalStore,
  ProposalGovernanceService,
} from "@/lib/governance/proposals";

export const dynamic = "force-dynamic";

const applySchema = z.object({
  imports: z
    .array(
      z.object({
        targetEventId: z.string().uuid(),
        items: z.array(
          z.object({
            folkPersonId: z.string().min(1),
            fullName: z.string().min(1),
            email: z.string().nullable().optional(),
            jobTitle: z.string().nullable().optional(),
            folkCompanyId: z.string().nullable().optional(),
            companyName: z.string().nullable().optional(),
            linkedinUrl: z.string().nullable().optional(),
            sheetNotes: z.string().nullable().optional(),
          }),
        ),
      }),
    )
    .default([]),
  flagUnmatched: z
    .array(
      z.object({
        targetEventId: z.string().uuid(),
        locale: z.string().min(1),
        rawName: z.string().min(1),
        companyHint: z.string().nullable().optional(),
        roleHint: z.string().nullable().optional(),
        sheetNotes: z.string().nullable().optional(),
      }),
    )
    .default([]),
});

export async function POST(request: Request) {
  try {
    const founder = await requireFounderSession();
    if (!isDatabaseConfigured()) {
      return Response.json(
        { error: "Database is not configured" },
        { status: 503 },
      );
    }

    const body = applySchema.parse(await request.json());
    const db = getDb();

    const targetEventIds = Array.from(
      new Set([
        ...body.imports.map((m) => m.targetEventId),
        ...body.flagUnmatched.map((u) => u.targetEventId),
      ]),
    );

    if (targetEventIds.length > 0) {
      const foundEvents = await db
        .select({ id: schema.breakfastEvents.id })
        .from(schema.breakfastEvents)
        .where(inArray(schema.breakfastEvents.id, targetEventIds));
      const foundSet = new Set(foundEvents.map((e) => e.id));
      const missingId = targetEventIds.find((id) => !foundSet.has(id));
      if (missingId) {
        return Response.json(
          { error: `Target breakfast event ${missingId} not found` },
          { status: 404 },
        );
      }
    }

    let importedCount = 0;
    let skippedAlreadyOnEvent = 0;
    let skippedSuppressed = 0;
    const perEventCounts: Record<
      string,
      { imported: number; skippedAlreadyOnEvent: number; skippedSuppressed: number }
    > = {};

    for (const mapping of body.imports) {
      const eventStats = perEventCounts[mapping.targetEventId] ?? {
        imported: 0,
        skippedAlreadyOnEvent: 0,
        skippedSuppressed: 0,
      };
      perEventCounts[mapping.targetEventId] = eventStats;

      for (const item of mapping.items) {
        let folkCompanyLinkId: string | null = null;
        if (item.folkCompanyId && item.companyName) {
          const [companyRow] = await db
            .insert(schema.folkCompaniesLink)
            .values({
              folkCompanyId: item.folkCompanyId,
              name: item.companyName,
              lastSyncedAt: new Date(),
              syncStatus: "linked",
            })
            .onConflictDoUpdate({
              target: schema.folkCompaniesLink.folkCompanyId,
              set: {
                name: item.companyName,
                lastSyncedAt: new Date(),
                updatedAt: new Date(),
              },
            })
            .returning({ id: schema.folkCompaniesLink.id });
          folkCompanyLinkId = companyRow?.id ?? null;
        }

        const [personRow] = await db
          .insert(schema.folkPeopleLink)
          .values({
            folkPersonId: item.folkPersonId,
            folkCompanyLinkId,
            fullName: item.fullName,
            email: item.email ?? null,
            jobTitle: item.jobTitle ?? null,
            linkedinUrl: item.linkedinUrl ?? null,
            lastSyncedAt: new Date(),
            syncStatus: "linked",
          })
          .onConflictDoUpdate({
            target: schema.folkPeopleLink.folkPersonId,
            set: {
              ...(folkCompanyLinkId ? { folkCompanyLinkId } : {}),
              fullName: item.fullName,
              email: item.email ?? null,
              jobTitle: item.jobTitle ?? null,
              linkedinUrl: item.linkedinUrl ?? null,
              lastSyncedAt: new Date(),
              updatedAt: new Date(),
            },
          })
          .returning();

        if (personRow.contactSuppressed) {
          skippedSuppressed += 1;
          eventStats.skippedSuppressed += 1;
          continue;
        }

        const [insertedInvite] = await db
          .insert(schema.breakfastInvitations)
          .values({
            eventId: mapping.targetEventId,
            folkPersonLinkId: personRow.id,
            responseStatus: "provisional",
            attendanceOutcome: "pending",
            waitlistStatus: "none",
            chaseStatus: "none",
          })
          .onConflictDoNothing()
          .returning();

        if (!insertedInvite) {
          skippedAlreadyOnEvent += 1;
          eventStats.skippedAlreadyOnEvent += 1;
          continue;
        }

        await db.insert(schema.breakfastInvitationHistory).values({
          invitationId: insertedInvite.id,
          changedByUserId: founder.userId,
          previousResponseStatus: null,
          newResponseStatus: insertedInvite.responseStatus,
          previousAttendanceOutcome: null,
          newAttendanceOutcome: insertedInvite.attendanceOutcome,
          previousWaitlistStatus: null,
          newWaitlistStatus: insertedInvite.waitlistStatus,
          note: item.sheetNotes
            ? `Imported from Breakfast2 spreadsheet — ${item.sheetNotes}`
            : "Imported from Breakfast2 spreadsheet",
        });

        importedCount += 1;
        eventStats.imported += 1;
      }
    }

    let queuedForReviewCount = 0;
    if (body.flagUnmatched.length > 0) {
      const store = createDrizzleProposalStore();
      const proposalService = new ProposalGovernanceService(store);

      for (const unmatched of body.flagUnmatched) {
        const normalizedName = normalizePersonName(unmatched.rawName);
        const idempotencyKey = `breakfast2_missing:${unmatched.targetEventId}:${normalizedName}`;
        const existingProposal = await store.findByIdempotencyKey(idempotencyKey);
        if (existingProposal) continue;

        const shortHash = sha256Hex(
          canonicalStringify({
            targetEventId: unmatched.targetEventId,
            name: normalizedName,
          }),
        ).slice(0, 12);

        const descParts = [
          unmatched.companyHint ? `Company: ${unmatched.companyHint}` : null,
          unmatched.sheetNotes ? `Notes: ${unmatched.sheetNotes}` : null,
        ].filter(Boolean);

        await proposalService.createProposal({
          targetSystem: "folk",
          entityType: "person",
          entityId: `new:breakfast2:${shortHash}`,
          folkRecordId: null,
          proposedByUserId: founder.userId,
          summary: `Not in Folk (${unmatched.locale} breakfast): ${unmatched.rawName}${unmatched.companyHint ? ` — ${unmatched.companyHint}` : ""}`,
          proposedChangesJson: {
            _operation: "create_person",
            _targetBreakfastEventId: unmatched.targetEventId,
            fullName: unmatched.rawName.trim(),
            ...(unmatched.roleHint?.trim()
              ? { jobTitle: unmatched.roleHint.trim() }
              : {}),
            ...(descParts.length > 0
              ? { description: descParts.join(" | ") }
              : {}),
          },
          baseSnapshotJson: {},
          sourceNote: "Breakfast2 Excel import — contact not found in Folk CRM",
          factType: "verified",
          evidenceDate: new Date(),
          idempotencyKey,
        });

        queuedForReviewCount += 1;
      }
    }

    // Touch updatedAt on target events when invites were inserted
    for (const [eventId, stats] of Object.entries(perEventCounts)) {
      if (stats.imported > 0) {
        await db
          .update(schema.breakfastEvents)
          .set({ updatedAt: new Date() })
          .where(eq(schema.breakfastEvents.id, eventId));
      }
    }

    await recordAuditEvent({
      actorType: "human",
      actorUserId: founder.userId,
      action: "breakfast_import_applied",
      entityType: "breakfast_event",
      entityId: targetEventIds[0] ?? null,
      newValue: {
        importedCount,
        skippedAlreadyOnEvent,
        skippedSuppressed,
        queuedForReviewCount,
        perEventCounts,
      },
      outcome: "succeeded",
    });

    return Response.json({
      importedCount,
      skippedAlreadyOnEvent,
      skippedSuppressed,
      queuedForReviewCount,
      perEventCounts,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
