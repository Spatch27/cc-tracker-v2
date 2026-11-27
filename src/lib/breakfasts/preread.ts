import type { AppDatabase } from "@/db";
import { loadFullBreakfastWorkspace } from "./queries";
import { isConfirmedGuestSeat } from "./rules";

export async function buildBreakfastPrereadContext(
  db: AppDatabase,
  eventId: string,
) {
  const workspace = await loadFullBreakfastWorkspace(db, eventId);
  const { event, founders, hosts, capacity, invitations } = workspace;

  const founderMap = new Map(founders.map((f) => [f.id, f]));
  const attendingHosts = hosts
    .filter((h) => h.attending)
    .map((h) => founderMap.get(h.userId)?.name ?? h.userId);

  const confirmedGuests = invitations.filter((inv) =>
    isConfirmedGuestSeat(inv),
  );
  const waitlistedGuests = invitations.filter(
    (inv) =>
      inv.waitlistStatus === "waitlisted" ||
      inv.waitlistStatus === "offered_place",
  );

  const lines: string[] = [
    `# Claude Preread Context — ${event.title}`,
    "",
    `- **Locale:** ${event.locale}`,
    `- **Date:** ${event.eventDate.toISOString()}`,
    `- **Venue:** ${event.venueName ?? "TBC"}${event.venueAddress ? ` (${event.venueAddress})` : ""}`,
    `- **Attending Hosts (${attendingHosts.length}):** ${attendingHosts.join(", ") || "None selected"}`,
    `- **Capacity:** ${capacity.confirmedGuestCount} / ${capacity.guestCapacity} guest places filled (${capacity.totalCapacity} total room capacity)`,
    "",
    `## Confirmed Guests (${confirmedGuests.length})`,
    "",
    ...(confirmedGuests.length > 0
      ? confirmedGuests.map((inv) => {
          const p = inv.person;
          const bits = [
            `**${p?.fullName ?? "Unknown"}**`,
            p?.jobTitle ? `— ${p.jobTitle}` : null,
            p?.companyName ? `@ ${p.companyName}` : null,
            p?.folkPersonId ? `(Folk ID: \`${p.folkPersonId}\`)` : null,
            inv.earlyDepartureNote ? `[Timing: ${inv.earlyDepartureNote}]` : null,
            inv.specialRequests
              ? `[Special request: ${inv.specialRequests}]`
              : null,
          ].filter(Boolean);
          return `- ${bits.join(" ")}`;
        })
      : ["- No confirmed guests yet."]),
    "",
    `## Waitlist / Offered (${waitlistedGuests.length})`,
    "",
    ...(waitlistedGuests.length > 0
      ? waitlistedGuests.map(
          (inv) =>
            `- ${inv.person?.fullName ?? "Unknown"} (${inv.person?.companyName ?? "Company TBC"}) — ${inv.waitlistStatus}`,
        )
      : ["- None"]),
  ];

  if (event.prereadNotes) {
    lines.push("", "## Host Context Notes", "", event.prereadNotes);
  }

  return {
    eventId: event.id,
    title: event.title,
    locale: event.locale,
    eventDate: event.eventDate.toISOString(),
    venueName: event.venueName ?? null,
    prereadUrl: event.prereadUrl ?? null,
    prereadNotes: event.prereadNotes ?? null,
    attendingHosts,
    capacity,
    confirmedGuestsCount: confirmedGuests.length,
    confirmedGuests: confirmedGuests.map((inv) => ({
      invitationId: inv.id,
      folkPersonId: inv.person?.folkPersonId ?? null,
      fullName: inv.person?.fullName ?? "Unknown",
      jobTitle: inv.person?.jobTitle ?? null,
      companyName: inv.person?.companyName ?? null,
      earlyDepartureNote: inv.earlyDepartureNote ?? null,
      specialRequests: inv.specialRequests ?? null,
    })),
    waitlistedGuests: waitlistedGuests.map((inv) => ({
      invitationId: inv.id,
      fullName: inv.person?.fullName ?? "Unknown",
      companyName: inv.person?.companyName ?? null,
      waitlistStatus: inv.waitlistStatus,
    })),
    markdown: lines.join("\n"),
  };
}
