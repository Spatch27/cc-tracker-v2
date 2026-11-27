import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import {
  BreakfastWorkspaceClient,
  type SerializedBreakfastWorkspace,
} from "@/components/breakfasts/breakfast-workspace-client";
import { getDb, isDatabaseConfigured } from "@/db";
import { getFounderAccessState } from "@/lib/auth";
import { loadFullBreakfastWorkspace } from "@/lib/breakfasts/queries";

export const dynamic = "force-dynamic";

export default async function BreakfastDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const access = await getFounderAccessState();
  if (access.status === "unauthenticated") redirect("/sign-in");
  if (access.status === "forbidden") redirect("/access-denied");
  const founder = access.status === "authenticated" ? access.founder : null;

  if (!isDatabaseConfigured()) {
    redirect("/breakfasts");
  }

  const { id } = await params;
  const db = getDb();

  let rawWorkspace;
  try {
    rawWorkspace = await loadFullBreakfastWorkspace(db, id);
  } catch {
    notFound();
  }

  const serialized: SerializedBreakfastWorkspace = {
    event: {
      id: rawWorkspace.event.id,
      locale: rawWorkspace.event.locale,
      title: rawWorkspace.event.title,
      eventDate: rawWorkspace.event.eventDate.toISOString(),
      venueName: rawWorkspace.event.venueName,
      venueAddress: rawWorkspace.event.venueAddress,
      totalCapacity: rawWorkspace.event.totalCapacity,
      status: rawWorkspace.event.status,
      bookingStatus: rawWorkspace.event.bookingStatus,
      bookingReference: rawWorkspace.event.bookingReference,
      venueContact: rawWorkspace.event.venueContact,
      bookingDocsUrl: rawWorkspace.event.bookingDocsUrl,
      depositAmountPence: rawWorkspace.event.depositAmountPence,
      depositDueDate: rawWorkspace.event.depositDueDate
        ? rawWorkspace.event.depositDueDate.toISOString()
        : null,
      depositInvoiceRef: rawWorkspace.event.depositInvoiceRef,
      depositPaid: rawWorkspace.event.depositPaid,
      balanceAmountPence: rawWorkspace.event.balanceAmountPence,
      balanceDueDate: rawWorkspace.event.balanceDueDate
        ? rawWorkspace.event.balanceDueDate.toISOString()
        : null,
      balanceInvoiceRef: rawWorkspace.event.balanceInvoiceRef,
      balancePaid: rawWorkspace.event.balancePaid,
      logisticsOwnerUserId: rawWorkspace.event.logisticsOwnerUserId,
      prereadUrl: rawWorkspace.event.prereadUrl,
      prereadNotes: rawWorkspace.event.prereadNotes,
    },
    founders: rawWorkspace.founders,
    hosts: rawWorkspace.hosts.map((h) => ({
      id: h.id,
      userId: h.userId,
      attending: h.attending,
    })),
    capacity: rawWorkspace.capacity,
    invitations: rawWorkspace.invitations.map((inv) => ({
      id: inv.id,
      eventId: inv.eventId,
      folkPersonLinkId: inv.folkPersonLinkId,
      responseStatus: inv.responseStatus,
      attendanceOutcome: inv.attendanceOutcome,
      waitlistStatus: inv.waitlistStatus,
      chaseStatus: inv.chaseStatus,
      carriedForwardFromEventId: inv.carriedForwardFromEventId,
      dietaryNotes: inv.dietaryNotes,
      specialRequests: inv.specialRequests,
      earlyDepartureNote: inv.earlyDepartureNote,
      person: inv.person,
      history: inv.history.map((h) => ({
        id: h.id,
        previousResponseStatus: h.previousResponseStatus,
        newResponseStatus: h.newResponseStatus,
        previousAttendanceOutcome: h.previousAttendanceOutcome,
        newAttendanceOutcome: h.newAttendanceOutcome,
        previousWaitlistStatus: h.previousWaitlistStatus,
        newWaitlistStatus: h.newWaitlistStatus,
        note: h.note,
        createdAt: h.createdAt.toISOString(),
      })),
    })),
    feedback: rawWorkspace.feedback.map((f) => ({
      id: f.id,
      category: f.category,
      summary: f.summary,
      createdAt: f.createdAt.toISOString(),
    })),
    referrals: rawWorkspace.referrals.map((r) => ({
      id: r.id,
      referredByFolkPersonLinkId: r.referredByFolkPersonLinkId,
      referredName: r.referredName,
      referredCompany: r.referredCompany,
      referredRole: r.referredRole,
      referredEmail: r.referredEmail,
      status: r.status,
      notes: r.notes,
      createdAt: r.createdAt.toISOString(),
    })),
    manualCarryForwardOptions: rawWorkspace.manualCarryForwardOptions,
  };

  return (
    <AppShell activePath="/breakfasts" founder={founder}>
      <BreakfastWorkspaceClient
        initialWorkspace={serialized}
        currentFounderUserId={founder?.userId ?? null}
      />
    </AppShell>
  );
}
