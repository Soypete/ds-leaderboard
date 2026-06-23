# Contributing — how to implement new stuff

How the ds-leaderboard app is laid out and how to add a feature, a migration, or a
new board the right way.

## The shape

Next.js 15 (App Router) + Supabase (Postgres + Auth + Storage). TypeScript, ESM,
**`.js` extensions on relative imports** (NodeNext resolution). Tests with vitest.

```
src/
  app/                 # routes (pages + API). Server components by default.
    api/               # route handlers: ingest, moderate, media, auth, dev
    guilds/ trials/    # board pages
  lib/                 # the logic layer — pure-ish, unit-tested
    boards.ts          # global gold board queries
    trial-boards.ts    # trial speedrun queries
    guilds.ts          # guild reads + ownership writes
    ingest.ts          # receipt → pending rows
    receipt.ts         # VENDORED hash/verify — mirror of the game's receipt.ts
    auth.ts            # GitHub OAuth session + moderator checks
    db.ts              # Supabase clients (browser/anon + service) and row types
supabase/migrations/   # numbered SQL, applied in order
```

## Where code goes

- **DB query or business rule** → `src/lib/*.ts`, with a colocated `*.test.ts`.
  Keep it a function that takes a `SupabaseClient` so it's testable with a mock db.
- **A page** → `src/app/<route>/page.tsx` (server component; reads via lib helpers).
- **A write users trigger** → a **server action** (`'use server'`) that
  re-authenticates from the cookie (`currentPlayer`) and calls a lib helper. See
  `guilds/[slug]/RosterControls.tsx`.
- **A machine endpoint** → `src/app/api/<name>/route.ts` (e.g. ingest, gated by a
  secret or OAuth).

## House rules

- **The service client bypasses RLS — server only.** Never import service-client
  write helpers into client code. Anon client is for public reads.
- **Writes assume the route authorized the actor.** For per-row authority (e.g.
  "only the owner"), re-check inside the lib helper too (defense in depth) — see
  `setMemberRole` / `transferOwnership`.
- **`receipt.ts` is a vendored mirror** of the game's `src/ui/receipt.ts`. If the
  game changes the receipt shape or canonical hash, mirror it here byte-for-byte or
  hashes won't match. The schema-version field gates incompatibility.
- **Return shape for writes:** `GuildWriteResult<T>` / `IngestResult` — a tagged
  `{ ok: true, value }` | `{ ok: false, status, reason }`. Match it.

## Adding a migration

1. Create `supabase/migrations/000N_<name>.sql` (next number). Use
   `add column if not exists` / `create … if not exists` so re-runs are safe.
2. Apply locally: `npm run dev:reset` (drops, replays all migrations, reseeds).
3. If it adds a readable table/column, check the **RLS policies** in `0001_init.sql`
   — a new table needs a policy or the anon client can't read it.
4. On deploy: `supabase db push` (or paste into the SQL editor). Never load
   `seed.sql` in production — it's dev fixtures.

## Adding a feature — the loop

1. Write the lib helper + its test first (`npm run test:watch`).
2. Wire the page / server action / API route.
3. `npm run typecheck` and `npm test` green.
4. Manually verify with the local stack + dev-login (see TESTING.md §2).
5. `npm run build` (dev server stopped) as the final gate.

## Style

Player-facing prose carries the medieval/RPG voice (knights, guilds, banners).
Server/lib code uses plain technical voice — match the surrounding file. See the
game repo's `AGENTS.md` for the full flavor guide.
