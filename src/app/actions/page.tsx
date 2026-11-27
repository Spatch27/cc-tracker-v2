import { asc, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import {
  ActionsWorkspaceClient,
  type SerializedActionItem,
  type SerializedAwaitingActivity,
} from "@/components/actions/actions-workspace-client";
import { AppShell } from "@/components/app-shell";
import { getDb, isDatabaseConfigured, schema } from "@/db";
import { getFounderAccessState } from "@/lib/auth";
import { ensureAllowlistedFounders, type FounderOption } from "@/lib/founders";

export const dynamic = "force-dynamic";

export default async function ActionsPage() {
  const access = await getFounderAccessState();
  if (access.status === "unauthenticated") redirect("/sign-in");
  if (access.status === "forbidden") redirect("/access-denied");
  const founder = access.status === "authenticated" ? access.founder : null;

  let founders: FounderOption[] = [];
  let actions: SerializedActionItem[] = [];
  let awaitingReply: SerializedAwaitingActivity[] = [];

  if (isDatabaseConfigured()) {
    try {
      const db = getDb();
      founders = await ensureAllowlistedFounders(db);
      const [rawActions, accounts, companies, people, outboundRows, inboundRows] =
        await Promise.all([
          db
            .select()
            .from(schema.followUpActions)
            .orderBy(asc(schema.followUpActions.dueDate)),
          db.select().from(schema.goldAccounts),
          db.select().from(schema.folkCompaniesLink),
          db.select().from(schema.folkPeopleLink),
          db
            .select()
            .from(schema.outreachActivities)
            .where(eq(schema.outreachActivities.direction, "outbound"))
            .orderBy(desc(schema.outreachActivities.occurredAt))
            .limit(50),
          db
            .select({
              goldAccountId: schema.outreachActivities.goldAccountId,
              folkPersonLinkId: schema.outreachActivities.folkPersonLinkId,
              occurredAt: schema.outreachActivities.occurredAt,
            })
            .from(schema.outreachActivities)
            .where(eq(schema.outreachActivities.direction, "inbound")),
        ]);

      const founderMap = new Map(founders.map((f) => [f.id, f]));
      const companyMap = new Map(companies.map((c) => [c.id, c]));
      const accountMap = new Map(accounts.map((a) => [a.id, a]));
      const personMap = new Map(people.map((p) => [p.id, p]));

      actions = rawActions.map((a) => {
        const acc = a.goldAccountId ? accountMap.get(a.goldAccountId) : undefined;
        const comp = acc ? companyMap.get(acc.folkCompanyLinkId) : undefined;
        const p = a.folkPersonLinkId ? personMap.get(a.folkPersonLinkId) : undefined;
        return {
          id: a.id,
          goldAccountId: a.goldAccountId,
          companyName: comp?.name ?? null,
          personName: p?.fullName ?? null,
          ownerUserId: a.ownerUserId,
          ownerName: founderMap.get(a.ownerUserId)?.name ?? "Unknown",
          title: a.title,
          dueDate: a.dueDate.toISOString(),
          status: a.status,
          snoozeHistoryJson: a.snoozeHistoryJson ?? [],
        };
      });

      awaitingReply = outboundRows
        .filter(
          (out) =>
            !inboundRows.some(
              (inb) =>
                inb.occurredAt > out.occurredAt &&
                ((out.folkPersonLinkId &&
                  inb.folkPersonLinkId === out.folkPersonLinkId) ||
                  (out.goldAccountId && inb.goldAccountId === out.goldAccountId)),
            ),
        )
        .map((act) => {
          const acc = act.goldAccountId
            ? accountMap.get(act.goldAccountId)
            : undefined;
          const comp = acc ? companyMap.get(acc.folkCompanyLinkId) : undefined;
          const p = act.folkPersonLinkId
            ? personMap.get(act.folkPersonLinkId)
            : undefined;
          return {
            id: act.id,
            goldAccountId: act.goldAccountId,
            companyName: comp?.name ?? null,
            personName: p?.fullName ?? null,
            ownerName: act.ownerUserId
              ? founderMap.get(act.ownerUserId)?.name ?? null
              : null,
            channel: act.channel,
            subject: act.subject,
            occurredAt: act.occurredAt.toISOString(),
          };
        });
    } catch {
      actions = [];
      awaitingReply = [];
    }
  }

  return (
    <AppShell activePath="/actions" founder={founder}>
      <ActionsWorkspaceClient
        initialActions={actions}
        awaitingReplyActivities={awaitingReply}
        founders={founders}
      />
    </AppShell>
  );
}
