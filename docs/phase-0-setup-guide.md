# Phase 0 & Phase 1 Setup Guide

This workspace starts fresh for the Committed Citizens Opportunity Tracker (Next.js 16 + Neon Postgres + Drizzle ORM + Clerk Google Sign-In + Folk CRM REST API).

## 1. Create `.env.local`

Copy the template (never commit `.env.local`):

```bash
cp .env.example .env.local
```

## 2. Provision Neon Postgres & Clerk (Recommended via Vercel)

If you have the Vercel CLI installed (`npm i -g vercel`) and your project linked (`vercel link`):

```bash
# Provision Neon Postgres (auto-sets DATABASE_URL)
vercel integration add neon

# Provision Clerk (auto-sets NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY & CLERK_SECRET_KEY)
vercel integration add clerk

# Pull provisioned variables into .env.local
vercel env pull .env.local --yes
```

In your Clerk dashboard:
- Enable **Google** under *User & Authentication -> Social Connections*.
- Enable **Restricted / Allowlist** mode (or keep self-signup disabled and rely on both Clerk and `ALLOWED_FOUNDER_EMAILS`).
- Set `ALLOWED_FOUNDER_EMAILS=tim@committedcitizens.co.uk,ben@committedcitizens.co.uk` (exact Google email addresses for Tim and Ben) in `.env.local` and in Vercel Project Settings.

## 3. Push the Database Schema

Once `DATABASE_URL` is set in `.env.local`:

```bash
npm run db:push
```

## 4. Run the Read-Only Phase 0 Folk Probe

1. In Folk (`app.folk.app`), go to **Settings -> API** and generate an API key.
2. Add `FOLK_API_KEY=<your-token>` to `.env.local`.
3. Run the strictly read-only probe:

```bash
npm run folk:probe
```

This checks `GET` access across `/users`, `/groups`, `/people`, `/companies`, `/notes`, and `/interactions` (including `importedTypes=email`), tests whether both Tim's and Ben's interactions are visible under one API key, and writes a PII-redacted capability report to `docs/phase-0-folk-capability-report.md`.

## 5. Start Local Development

```bash
npm run dev
```

Visit `http://localhost:3000`.
