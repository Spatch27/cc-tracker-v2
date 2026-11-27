import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import {
  GoldAccountWorkspaceClient,
  type SerializedGoldWorkspace,
} from "@/components/gold-lists/gold-account-workspace-client";
import { getDb, isDatabaseConfigured } from "@/db";
import { getFounderAccessState } from "@/lib/auth";
import { loadGoldAccountWorkspace } from "@/lib/gold-lists/queries";

export const dynamic = "force-dynamic";

export default async function GoldAccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const access = await getFounderAccessState();
  if (access.status === "unauthenticated") redirect("/sign-in");
  if (access.status === "forbidden") redirect("/access-denied");
  const founder = access.status === "authenticated" ? access.founder : null;

  if (!isDatabaseConfigured()) {
    redirect("/gold-lists");
  }

  const { id } = await params;
  const db = getDb();

  let raw;
  try {
    raw = await loadGoldAccountWorkspace(db, id);
  } catch {
    notFound();
  }

  const serialized: SerializedGoldWorkspace = {
    account: {
      id: raw.account.id,
      ownerUserId: raw.account.ownerUserId,
      status: raw.account.status,
      marketingTeamSize: raw.account.marketingTeamSize,
      legacySetupNotes: raw.account.legacySetupNotes,
      fitNotes: raw.account.fitNotes,
      legacyScoreMetadataJson: raw.account.legacyScoreMetadataJson,
      lastInteractionsSyncAt: raw.account.lastInteractionsSyncAt
        ? raw.account.lastInteractionsSyncAt.toISOString()
        : null,
      lastInteractionsSyncNote: raw.account.lastInteractionsSyncNote,
      fit: raw.account.fit,
    },
    company: raw.company
      ? {
          id: raw.company.id,
          folkCompanyId: raw.company.folkCompanyId,
          name: raw.company.name,
          domain: raw.company.domain,
        }
      : null,
    founders: raw.founders,
    ownerCounts: raw.ownerCounts,
    contacts: raw.contacts.map((c) => ({
      id: c.id,
      folkPersonLinkId: c.folkPersonLinkId,
      roleCategory: c.roleCategory,
      isPrimaryDecisionMaker: c.isPrimaryDecisionMaker,
      coverageStatus: c.coverageStatus,
      notes: c.notes,
      person: c.person
        ? {
            id: c.person.id,
            folkPersonId: c.person.folkPersonId,
            fullName: c.person.fullName,
            email: c.person.email,
            jobTitle: c.person.jobTitle,
            linkedinUrl: c.person.linkedinUrl,
          }
        : null,
    })),
    intelligence: raw.intelligence.map((i) => ({
      id: i.id,
      dimension: i.dimension,
      summary: i.summary,
      factType: i.factType,
      evidenceDate: i.evidenceDate ? i.evidenceDate.toISOString() : null,
      observedAt: i.observedAt.toISOString(),
      sourceUrl: i.sourceUrl,
      sourceNote: i.sourceNote,
    })),
    signals: raw.signals.map((s) => ({
      id: s.id,
      signalType: s.signalType,
      title: s.title,
      details: s.details,
      factType: s.factType,
      signalDate: s.signalDate ? s.signalDate.toISOString() : null,
      observedAt: s.observedAt.toISOString(),
      sourceUrl: s.sourceUrl,
      sourceNote: s.sourceNote,
    })),
    activities: raw.activities.map((a) => ({
      id: a.id,
      folkPersonLinkId: a.folkPersonLinkId,
      channel: a.channel,
      direction: a.direction,
      ownerUserId: a.ownerUserId,
      ownerName: a.ownerName,
      personName: a.personName,
      conversationKey: a.conversationKey,
      subject: a.subject,
      bodyPreview: a.bodyPreview,
      sourceSystem: a.sourceSystem,
      folkInteractionId: a.folkInteractionId,
      executionStatus: a.executionStatus,
      visibilityRestricted: a.visibilityRestricted,
      occurredAt: a.occurredAt.toISOString(),
    })),
    actions: raw.actions.map((a) => ({
      id: a.id,
      folkPersonLinkId: a.folkPersonLinkId,
      personName: a.personName,
      ownerUserId: a.ownerUserId,
      ownerName: a.ownerName,
      title: a.title,
      notes: a.notes,
      dueDate: a.dueDate.toISOString(),
      status: a.status,
      flaggedByReplyActivityId: a.flaggedByReplyActivityId,
      snoozeHistoryJson: a.snoozeHistoryJson ?? [],
    })),
    relatedBreakfasts: raw.relatedBreakfasts.map((rb) => ({
      ...rb,
      eventDate: rb.eventDate ? rb.eventDate.toISOString() : null,
    })),
  };

  return (
    <AppShell activePath="/gold-lists" founder={founder}>
      <GoldAccountWorkspaceClient
        initialWorkspace={serialized}
        currentFounderUserId={founder?.userId ?? null}
      />
    </AppShell>
  );
}
