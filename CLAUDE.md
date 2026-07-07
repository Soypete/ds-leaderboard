# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

The leaderboard web app for **Dragonslayer** (the terminal RPG in the sibling
`../DragonSlayer` repo). It ingests signed "run receipts" the game produces and ranks them on
speedrun.com-style boards. Two boards: **gold earned in a day** (screenshot-backed, the built
MVP) and **per-trial vim speedruns** (video-backed, Phase 2). See `README.md` for the product
shape and `HOSTING.md` for the cost/deploy plan.

## Commands

```bash
npm run dev          # next dev — http://localhost:3000
npm run build        # next build (run this before claiming a change works; it typechecks + RSC-compiles)
npm run typecheck    # tsc --noEmit
npm test             # vitest run (currently the receipt validator/hash suite)
npx vitest run src/lib/receipt.test.ts      # a single test file
npx vitest run -t "rejects a tampered"      # a single test by name
```

There is no live backend in dev unless Supabase env vars are set (see `.env.example`). Pages
are written to render a "not configured" notice instead of crashing, so UI work doesn't need a
database.

## The one rule that bites: the receipt contract

`src/lib/receipt.ts` (`canonicalReceipt` / `hashReceipt`) **must stay byte-identical** to the
game's `../DragonSlayer/src/ui/receipt.ts`. The game seals a `sha256` over a canonical,
fixed-key-order, whitespace-free JSON render; this repo recomputes that hash to detect
tampering. Any change to the field set, key order, or canonicalization in one repo must be
mirrored in the other, or every receipt fails verification. The shared `Receipt`/`ReceiptTrial`
types also mirror the game's `src/types.ts`.

Authenticity is layered: **the hash proves integrity, not identity.** Identity comes from the
ingest layer matching `receipt.githubHandle` to the PR author (the GitHub Action) or the OAuth
session. Never treat a valid hash as proof of who submitted it.

## Architecture

**Two Supabase clients, never mixed** (`src/lib/db.ts`):
- `browserClient()` — anon key, RLS-enforced. Safe in the browser and SSR reads. Sees only
  approved + publicly-visible rows.
- `serviceClient()` — service-role key, **server-only**, bypasses RLS. Used by the ingest and
  moderate API routes and the moderator queue page. Importing it into a client component leaks
  the key — don't.

**The write path** (untrusted → pending rows):
`api/ingest/route.ts` checks the shared secret + author match → `lib/ingest.ts` re-validates the
receipt (`validateReceipt`: structure + hash), upserts the player, inserts `pending`
`daily_gold_runs` (one canonical row per player/day/realm) and `trial_runs`. Trial ids not yet in
the `trials` catalog are skipped (FK violation `23503`), not fatal — the gold haul still lands.

**The moderation path** (`api/moderate/route.ts` → `lib/moderate.ts`): flips a pending run to
approved/rejected, writes a `verification_events` audit row. Approval is gated on the required
media existing (gold → screenshot, trial → video); rejection requires a note.

**The read path** (`lib/boards.ts`): RLS does the visibility filtering, so the public board query
just selects `status='approved'` and orders by gold. Supabase types an embedded relation
(`players!inner(github_handle)`) as a possible array — `boards.ts` normalizes that with
`handleOf()`; keep that shape when adding joins.

**Ingest is GitHub-based**, not a direct game→server call. The workflows live in the
**ds-submissions repo** (two-stage: `validate-receipt.yml` checks PRs with no secrets so forks
work; `ingest-on-merge.yml` POSTs to `/api/ingest` with `INGEST_SHARED_SECRET` after a maintainer
merges). The route re-validates the hash and re-enforces author==handle server-side.

**RLS is the security boundary** (`supabase/migrations/0001_init.sql`): anon reads see only
approved/global/public-guild rows; there are no anon writes at all — every write goes through the
service role. When adding a table, enable RLS and add an explicit read policy, or the board won't
see its rows.

## Module resolution gotcha

`tsconfig.json` uses `moduleResolution: Bundler`, so **relative imports are extensionless**
(`from './receipt'`, not `'./receipt.js'`). The `.js`-suffixed style the game repo uses (NodeNext)
breaks the Next.js webpack build here. Path alias `@/*` → `src/*`.

## Phasing

MVP (built): gold board, PR ingest, screenshots, moderator queue. Phase 2: per-trial video
boards + the `trials` catalog sync from the game (`gme leaderboard trials --json`). Phase 3:
guilds (private boards, invites) + a self-host docker kit. The schema already carries the Phase
2/3 tables; the UI and sync jobs are what's pending.
