import { getDb, isDatabaseConfigured } from "@/db";
import { errorResponse } from "@/lib/api-auth";
import { requireFounderSession } from "@/lib/auth";
import { loadFullBreakfastWorkspace } from "@/lib/breakfasts/queries";
import { isConfirmedGuestSeat } from "@/lib/breakfasts/rules";

export const dynamic = "force-dynamic";

export async function GET(
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
    const db = getDb();
    const workspace = await loadFullBreakfastWorkspace(db, id);
    const { event, founders, hosts, capacity, invitations } = workspace;

    const founderMap = new Map(founders.map((f) => [f.id, f]));
    const attendingHostNames = hosts
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
      `- **Attending Hosts (${attendingHostNames.length}):** ${attendingHostNames.join(", ") || "None selected"}`,
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
              inv.earlyDepartureNote
                ? `[Timing: ${inv.earlyDepartureNote}]`
                : null,
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

    return Response.json({
      eventId: event.id,
      markdown: lines.join("\n"),
      confirmedGuestsCount: confirmedGuests.length,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
