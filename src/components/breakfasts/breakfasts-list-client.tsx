"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  CheckCircle2,
  MapPin,
  Plus,
  Upload,
  Users,
  X,
} from "lucide-react";
import type { FounderOption } from "@/lib/founders";
import type { BreakfastCapacityMetrics } from "@/lib/breakfasts/rules";

export interface BreakfastSummaryItem {
  id: string;
  locale: string;
  title: string;
  eventDate: string;
  venueName: string | null;
  totalCapacity: number;
  status: string;
  bookingStatus: string | null;
  depositPaid: boolean;
  balancePaid: boolean;
  inviteeCount: number;
  capacity: BreakfastCapacityMetrics;
}

const PRESET_LOCALES = ["London", "Bristol", "Exeter"];

export function BreakfastsListClient({
  initialEvents,
  founders,
  queueCountsByLocale,
  dbReady,
}: {
  initialEvents: BreakfastSummaryItem[];
  founders: FounderOption[];
  queueCountsByLocale: Record<string, number>;
  dbReady: boolean;
}) {
  const router = useRouter();
  const [events, setEvents] = useState<BreakfastSummaryItem[]>(initialEvents);
  const [localeFilter, setLocaleFilter] = useState<string>("all");
  const [showCreate, setShowCreate] = useState(false);

  const [locale, setLocale] = useState("London");
  const [customLocale, setCustomLocale] = useState("");
  const [title, setTitle] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [venueName, setVenueName] = useState("");
  const [totalCapacity, setTotalCapacity] = useState(14);
  const [hostIds, setHostIds] = useState<string[]>(() =>
    founders.map((f) => f.id),
  );
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const allLocales = Array.from(
    new Set([...PRESET_LOCALES, ...events.map((e) => e.locale)]),
  );

  const filteredEvents =
    localeFilter === "all"
      ? events
      : events.filter(
          (e) => e.locale.toLowerCase() === localeFilter.toLowerCase(),
        );

  const totalQueued = Object.values(queueCountsByLocale).reduce(
    (sum, n) => sum + n,
    0,
  );

  function toggleHost(id: string) {
    setHostIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setCreating(true);

    const chosenLocale =
      locale === "__custom__" ? customLocale.trim() : locale;

    try {
      const res = await fetch("/api/breakfasts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locale: chosenLocale,
          title,
          eventDate: new Date(eventDate).toISOString(),
          venueName: venueName || null,
          totalCapacity: Number(totalCapacity),
          attendingHostUserIds: hostIds,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to create breakfast");
        return;
      }

      if (data.carriedForwardCount > 0) {
        setNotice(
          `Created "${data.event.title}" and automatically carried forward ${data.carriedForwardCount} same-locale contact(s) into the provisional invite list.`,
        );
      }

      const listRes = await fetch("/api/breakfasts");
      if (listRes.ok) {
        const listData = await listRes.json();
        setEvents(
          listData.events.map((ev: BreakfastSummaryItem & { eventDate: string }) => ({
            ...ev,
            eventDate: new Date(ev.eventDate).toISOString(),
          })),
        );
      }

      setShowCreate(false);
      setTitle("");
      setVenueName("");
      router.refresh();
    } catch {
      setError("Network error creating breakfast event");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-accent" />
            <h1 className="text-2xl font-semibold tracking-tight">
              CMO Breakfasts
            </h1>
          </div>
          <p className="text-sm text-muted mt-1">
            Locale-based invitation lists, host-aware capacity, booking
            logistics, manual waitlist, and carry-forward.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/breakfasts/import"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-3.5 py-2 text-xs font-medium text-foreground hover:border-accent"
          >
            <Upload className="h-3.5 w-3.5 text-accent" />
            Import from Excel
          </Link>
          <button
            type="button"
            disabled={!dbReady}
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-40"
          >
            <Plus className="h-4 w-4" />
            New Breakfast
          </button>
        </div>
      </div>

      {!dbReady && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-xs text-warning">
          Database tables need an update for Phase 2. Go to{" "}
          <Link href="/" className="underline font-semibold">
            Overview
          </Link>{" "}
          and click <strong>Update Database Tables</strong>.
        </div>
      )}

      {notice && (
        <div className="rounded-xl border border-success/40 bg-success/10 p-3.5 text-xs text-success flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {totalQueued > 0 && (
        <div className="rounded-xl border border-accent/40 bg-accent/10 p-4 text-xs text-foreground space-y-1">
          <p className="font-semibold text-accent">
            Same-locale carry-forward queue active ({totalQueued} contact
            {totalQueued === 1 ? "" : "s"} waiting)
          </p>
          <p className="text-muted">
            {Object.entries(queueCountsByLocale)
              .map(([loc, count]) => `${loc}: ${count}`)
              .join(" · ")}{" "}
            — automatically added as provisional invitees when you create the
            next breakfast in that locale.
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setLocaleFilter("all")}
          className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
            localeFilter === "all"
              ? "border-accent bg-accent/15 text-accent"
              : "border-border bg-surface text-muted hover:text-foreground"
          }`}
        >
          All Locales ({events.length})
        </button>
        {allLocales.map((loc) => (
          <button
            key={loc}
            type="button"
            onClick={() => setLocaleFilter(loc)}
            className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
              localeFilter.toLowerCase() === loc.toLowerCase()
                ? "border-accent bg-accent/15 text-accent"
                : "border-border bg-surface text-muted hover:text-foreground"
            }`}
          >
            {loc}
          </button>
        ))}
      </div>

      {filteredEvents.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-8 text-center space-y-2">
          <p className="text-sm font-medium text-foreground">
            No breakfast events in this view yet
          </p>
          <p className="text-xs text-muted">
            Create your first London, Bristol, or Exeter CMO Breakfast to start
            building the invite list from Folk CRM.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredEvents.map((ev) => (
            <Link
              key={ev.id}
              href={`/breakfasts/${ev.id}`}
              className="rounded-xl border border-border bg-surface p-5 hover:border-accent/60 transition-colors space-y-4 block"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-md bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent">
                      <MapPin className="h-3 w-3" />
                      {ev.locale}
                    </span>
                    <span className="rounded-md border border-border bg-surface-elevated px-2 py-0.5 text-[11px] font-mono text-muted">
                      {ev.status}
                    </span>
                  </div>
                  <h2 className="text-base font-semibold mt-2 text-foreground">
                    {ev.title}
                  </h2>
                  <p className="text-xs text-muted mt-0.5">
                    {new Date(ev.eventDate).toLocaleDateString("en-GB", {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                    {ev.venueName ? ` · ${ev.venueName}` : " · Venue TBC"}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-surface-elevated p-3 text-xs">
                <div>
                  <span className="text-muted block">Guest Seats</span>
                  <span className="font-semibold text-foreground">
                    {ev.capacity.confirmedGuestCount} / {ev.capacity.guestCapacity}
                  </span>
                </div>
                <div>
                  <span className="text-muted block">Room / Hosts</span>
                  <span className="font-mono text-foreground">
                    {ev.capacity.totalCapacity} ({ev.capacity.attendingHostCount}h)
                  </span>
                </div>
                <div>
                  <span className="text-muted block">Waitlist</span>
                  <span className="font-mono text-foreground">
                    {ev.capacity.waitlistedCount} waiting
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-muted">
                <span className="inline-flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" />
                  {ev.inviteeCount} on list
                </span>
                <span>
                  Booking: {ev.bookingStatus ?? "unconfirmed"} ·{" "}
                  {ev.depositPaid ? "Deposit paid" : "Deposit pending"}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-surface p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Create CMO Breakfast</h2>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="text-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {error && (
              <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
                {error}
              </div>
            )}

            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted block">Locale</label>
                  <select
                    value={locale}
                    onChange={(e) => setLocale(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground"
                  >
                    {PRESET_LOCALES.map((loc) => (
                      <option key={loc} value={loc}>
                        {loc}
                      </option>
                    ))}
                    <option value="__custom__">Other locale...</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted block">
                    Total Room Capacity (incl. hosts)
                  </label>
                  <input
                    type="number"
                    min={2}
                    max={100}
                    required
                    value={totalCapacity}
                    onChange={(e) => setTotalCapacity(Number(e.target.value))}
                    className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground"
                  />
                </div>
              </div>

              {locale === "__custom__" && (
                <div className="space-y-1">
                  <label className="text-xs text-muted block">
                    Custom Locale Name
                  </label>
                  <input
                    type="text"
                    required
                    value={customLocale}
                    onChange={(e) => setCustomLocale(e.target.value)}
                    placeholder="e.g. Manchester"
                    className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground"
                  />
                </div>
              )}

              <div className="space-y-1">
                <label className="text-xs text-muted block">Event Title</label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. London CMO Breakfast — Q1"
                  className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted block">
                    Date &amp; Start Time
                  </label>
                  <input
                    type="datetime-local"
                    required
                    value={eventDate}
                    onChange={(e) => setEventDate(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted block">
                    Venue (optional)
                  </label>
                  <input
                    type="text"
                    value={venueName}
                    onChange={(e) => setVenueName(e.target.value)}
                    placeholder="e.g. The Ned"
                    className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="text-xs text-muted block">
                  Attending Hosts (subtracted from total room capacity →{" "}
                  <strong className="text-foreground">
                    {Math.max(0, totalCapacity - hostIds.length)} guest seats
                  </strong>
                  )
                </span>
                <div className="flex flex-wrap gap-2">
                  {founders.map((f) => {
                    const checked = hostIds.includes(f.id);
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => toggleHost(f.id)}
                        className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                          checked
                            ? "border-accent bg-accent/15 text-accent font-medium"
                            : "border-border bg-surface-elevated text-muted"
                        }`}
                      >
                        {f.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="rounded-lg border border-border px-4 py-2 text-xs text-muted hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground disabled:opacity-40"
                >
                  {creating ? "Creating..." : "Create Breakfast"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
