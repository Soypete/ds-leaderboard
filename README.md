# Dragonslayer Leaderboards

Speedrun-style leaderboards for [Dragonslayer](../DragonSlayer) — the terminal RPG where
bugs are dragons and reliable code wins the kingdom.

Two boards (speedrun.com-style, good-faith + media):

1. **Gold earned in a day** — the biggest single-day hauls (coverage reclaimed, dragons
   slain, quests cleared), each backed by a **screenshot**. *(MVP — built)*
2. **Per-trial vim speedruns** — one board per trial, ranked by time, each backed by a
   **video**. *(Phase 2 — schema in place, boards pending)*

Plus private **guilds** for teams, hosted and self-hostable. *(Phase 3)*

## How a run gets on a board

```
gme leaderboard whoami --set <github-handle>     # once
gme leaderboard receipt --out receipts/<handle>-<day>.json
# open a PR adding that file to the submissions repo
```

The game seals a JSON **receipt** (day's gold haul + standing trial times) with a
`sha256` content hash. A GitHub Action checks the receipt's handle matches the PR author
(anti-impersonation), confirms the hash, and inserts a **pending** run. A moderator reviews
the screenshot/video and approves it onto the board.

The hash proves the receipt wasn't altered; the author match proves identity; the media is
the real proof. See [`src/lib/receipt.ts`](src/lib/receipt.ts) — kept byte-compatible with
the game's `src/ui/receipt.ts`.

## Stack

Next.js (App Router) on Vercel · Supabase Postgres + Storage (S3-compatible) · GitHub
Actions ingest. Designed to run **free** through the MVP. See [HOSTING.md](HOSTING.md) for
the cost plan, the S3/CORS upload flow, and deploy steps.

## Layout

```
src/app/                 Next.js routes
  page.tsx               gold-per-day board (ISR)
  moderate/              moderator queue (approve/reject)
  trials/                per-trial boards (Phase 2 stub)
  api/ingest/            receipt ingest (Action → pending rows)
  api/moderate/          approve/reject a run
src/lib/
  receipt.ts             receipt contract + hash verify + structural validation
  ingest.ts              validated receipt → pending board rows
  boards.ts              board read queries (RLS-aware)
  moderate.ts            approve/reject + media gate + audit trail
  db.ts                  Supabase clients (anon vs service) + row types
supabase/migrations/     Postgres schema + RLS
.github/workflows/       receipt-ingest Action (copy into the submissions repo)
```

## Develop

```bash
npm install
cp .env.example .env.local      # fill in Supabase keys once the project exists
npm run dev                     # http://localhost:3000
npm run typecheck
npm test                        # receipt validator/hash tests
```

Without Supabase env vars the board pages render a "not configured" notice rather than
crashing, so you can iterate on UI before wiring the backend.
