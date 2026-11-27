# Committed Citizens Opportunity Tracker (v1)

Two-founder operational workspace for **Tim Burley** and **Ben Scoggins**, connecting **CMO Breakfasts**, **Gold Lists**, **Folk CRM**, and external AI agents behind explicit human approval gates.

## 1. Scope & Governance Rules

- **CMO Breakfasts (`/breakfasts`)**: Locale-based invite lists (Bristol, London, Exeter, etc.), host-aware capacity (`guestCapacity = totalCapacity - attendingHostCount`), booking & deposit/balance tracking, separate invite status vs. attendance outcomes with history, manual waitlist promotion, automatic same-locale carry-forward for `declined` respondents (respecting `Do Not Contact`), event-only attendee notes, Claude preread context, post-event feedback, and referrals.
- **Gold Lists (`/gold-lists`)**: Shared account workspaces strictly capped at **50 active companies per founder**, decision-maker mapping & coverage gaps, dated **Team / Process / Data / Tech** intelligence distinguishing verified facts vs. interpretations, buying signals, cross-founder outreach timeline (entity-scoped Folk sync + manual LinkedIn/postcard logging), and founder-owned follow-up actions with snooze history and inbound-reply review flags (`/actions`).
- **Review Queue & Folk Reconciliation (`/reviews`)**: Every research update, new-contact creation (`Approve & Add to Folk`), stale-data warning, or live Folk drift enters human review before Folk or Tracker links are overwritten.
- **Message Approvals (`/approvals`)**: Every outgoing draft binds to a SHA-256 content hash (`contentHash`). Editing an approved draft clears approval. Approving issues a single-use `approvalToken` and **never** automatically marks a message `sent` until external execution reports back.
- **Out of v1 Scope**: Warm List, Cold list, sales pipeline (stays in Folk CRM), automatic waitlist promotion, and automated email/LinkedIn sending.

## 2. Tech Stack & Environment Variables

- **Framework**: Next.js 16 (App Router, TypeScript), Tailwind CSS v4
- **Database**: Neon PostgreSQL (`@neondatabase/serverless`) + Drizzle ORM
- **Auth**: Clerk Google Sign-In (`@clerk/nextjs`) + fail-closed `ALLOWED_FOUNDER_EMAILS` allowlist
- **CRM**: Folk CRM REST API v1 (`https://api.folk.app/v1`)

Configure these variable names in Vercel Project Settings (and `.env.local` for local development — never commit `.env.local` or secret values):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon PostgreSQL pooled connection string |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key |
| `CLERK_SECRET_KEY` | Clerk secret key |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | `/sign-in` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `/sign-up` |
| `ALLOWED_FOUNDER_EMAILS` | Comma-separated allowlisted founder Google emails (fail-closed if empty) |
| `FOLK_API_KEY` | Folk CRM API Bearer token (Workspace Settings -> API) |
| `FOLK_API_BASE_URL` | Optional override (defaults to `https://api.folk.app/v1`) |
| `CRON_SECRET` | Optional Bearer token authorizing scheduled `POST /api/folk/reconcile` runs |
| `APP_URL` | Base URL (`http://localhost:3000` locally) |

## 3. Setup, Database Migrations & Folk Diagnostics

### Founder Browser Workflow (No Terminal Required)
1. Deploy to Vercel (`main` branch auto-deploys).
2. Sign in with an allowlisted Google account.
3. On **Overview (`/`)** or **Administration (`/admin`)**:
   - Click **Initialize / Re-check Database Tables** (`POST /api/admin/migrate`) to apply all Drizzle SQL migrations in `drizzle/`.
   - Click **Run Read-Only Folk API Probe** (`POST /api/admin/folk-probe`) to confirm read access across Folk users, groups, custom fields, people, companies, notes, and entity-scoped interactions.
4. On **Review Queue (`/reviews`)**:
   - Click **Run Folk Sync Check** (`POST /api/folk/reconcile`) to compare linked people/companies against live Folk and surface any drift as **Data Conflicts**.

### Local Developer Commands
```bash
npm install
npm run typecheck
npm run test
npx next build --webpack
```

When modifying `src/db/schema.ts`, generate a new migration before deploying:
```bash
npm run db:generate
```

## 4. Agent Onboarding & Tracker MCP (`/api/mcp`)

External agents (Claude, research bots, sending assistants) authenticate via **Administration (`/admin`)** using revocable SHA-256-hashed Bearer tokens (`cc_ag_...`). Raw tokens are shown once at creation and never stored in plaintext.

### Issuing Least-Privilege Agent Tokens
1. Open **Administration (`/admin`) -> Issue Scoped Agent Token**.
2. Choose a descriptive name (e.g. `Claude Breakfast Preread`) and grant **only** the required scopes:
   - `read:context` — Read breakfasts, preread context, Gold accounts, proposal/message status.
   - `propose:research` — Submit proposed Folk/Tracker updates into `pending_review` (never writes directly to Folk).
   - `draft:message` — Create/edit individual message drafts in `awaiting_approval`.
   - `report:execution` — Report `sent` / `failed` / `outcome_unknown` outcomes using a valid single-use `approvalToken` + `executionIdempotencyKey`.
   - `log:activity` — Log outreach activities or inbound replies (automatically flags matching open actions to `needs_review`).
   - `manage:actions` — Create, snooze (with preserved history), complete, or reopen follow-up actions.
3. To revoke an agent immediately, click **Revoke** next to its entry in `/admin` (`revokedAt` takes effect on the next request).

### Scoped MCP Tools (`POST /api/mcp`)
Send JSON-RPC 2.0 requests with `Authorization: Bearer <agent-token>`:

| Tool | Required Scope | Purpose |
|---|---|---|
| `list_breakfasts` | `read:context` | List events, capacity, and invitee counts |
| `get_breakfast_preread_context` | `read:context` | Structured guests, roles, timing notes & markdown for Ben's Claude preread workflow |
| `list_gold_accounts` | `read:context` | List active/archived Gold accounts & founder caps |
| `get_gold_account_context` | `read:context` | Full account workspace (decision-makers, intelligence, signals, timeline, actions) |
| `submit_research_proposal` | `propose:research` | Queue research changes into Review Queue (`pending_review`) |
| `get_proposal_status` | `read:context` | Poll review/apply status and payload hash |
| `submit_message_draft` | `draft:message` | Create individual message draft in `awaiting_approval` |
| `get_message_approval_status` | `read:context` | Check message approval status (`approvalTokenHash` never exposed) |
| `report_message_execution` | `report:execution` | Report external send result (`sent` / `failed` / `outcome_unknown`) with `approvalToken` |
| `log_outreach_activity` | `log:activity` | Log activity/reply with `idempotencyKey` deduplication |
| `manage_follow_up_action` | `manage:actions` | Create, snooze, complete, or reopen follow-up actions |

Example `tools/call` request (e.g., Ben's Claude preread agent):
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "get_breakfast_preread_context",
    "arguments": { "eventId": "<breakfast-event-uuid>" }
  }
}
```

> **Governance Reminder:** Keep direct Folk-write and raw email/campaign-send tools restricted on external bots outside the tracker so research writes always pass through `/reviews` and messages always pass through `/approvals`.

## 5. Browser Dry-Run Spreadsheet Importers

Never commit `.xlsx` prospect sheets to GitHub. Both importers parse spreadsheets locally in the browser, match against full Folk CRM via server-side filters + pagination, preview every match, and apply idempotently:

- **CMO Breakfasts (`/breakfasts/import`)**: Reads the `Breakfast2` tab (Bristol, London, Exeter blocks), automatically stops before `HOLD` / `LEAVE` / `ATTENDED IN NOV`, adds matched invitees as `provisional` (*Not invited yet*), and routes any contacts not in Folk to `/reviews` (**Approve & Add to Folk** or **Pick Existing Folk Record**).
- **Gold Lists (`/gold-lists/import`)**: Reads only **`Tim ABM`** and **`Ben ABM`** tabs (explicitly excluding Warm List, Cold list, and Top 100 tabs), enforces the 50-company cap per founder, preserves legacy ranks/scores/personas read-only, logs `TBC` rows as coverage gaps, seeds signals, and routes unmatched companies & stale-email warnings to `/reviews`.

## 6. Backup, Restore & Incident Recovery

- **Database Backups (Neon PostgreSQL)**:
  - Neon maintains continuous point-in-time history. To recover from accidental data loss or test a schema change, create a **Branch from timestamp** in the Neon Console (`Branches -> Create branch -> Time / LSN`), verify rows against the branch connection string, and promote/swap `DATABASE_URL` in Vercel if a full restore is required.
- **Deployment Rollback (Vercel)**:
  - In Vercel Dashboard -> **Deployments**, click **Promote to Production** on the previous healthy deployment.
- **Compromised Agent Token**:
  - Open **Administration (`/admin`) -> Revoke** on the affected agent identity. Check `audit_events` for any recent `agent` actions or denied attempts.
- **Failed Integration Checks**:
  - Check **Overview (`/`) -> Last Folk Sync** and **Review Queue (`/reviews`) -> Folk Reconciliation** (`sync_runs` table records honest `succeeded` / `partial` / `failed` runs and exact error summaries).

## 7. Two-Founder Pilot Sign-Off Checklist

- [ ] Both Tim & Ben can sign in via Clerk Google SSO; any non-allowlisted Google account is redirected to `/access-denied`.
- [ ] One CMO Breakfast tested end-to-end (add/relink Folk contact, track response vs. attendance, test capacity & manual waitlist offer, capture dietary/timing note, copy Claude preread context, add feedback/referral).
- [ ] One Gold account per founder tested end-to-end (50-company cap enforced, decision-maker/gap mapped, Team/Process/Data/Tech fact logged, Folk interaction sync run, manual LinkedIn/postcard touchpoint logged, follow-up action snoozed/completed).
- [ ] Review Queue & Message Approvals tested (approve proposal & inspect audit record; edit message after approval resets approval; `sent` only recorded on execution report).
- [ ] Scoped `read:context` agent token tested against `POST /api/mcp` and verified blocked from out-of-scope tools.
- [ ] Neon point-in-time branch restore verified in Neon Console.
