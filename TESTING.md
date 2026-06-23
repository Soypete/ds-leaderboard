# Testing the Dragonslayer leaderboard

Every place tests run — **automatic** (run by you/CI) and **manual** (clicked or
walked through by a human) — across the three repos:

| Repo | What it is |
|---|---|
| **DragonSlayer** | the `gme` game + leaderboard CLI (seals receipts) |
| **ds-leaderboard** | the Next.js + Supabase web app (boards, guilds, ingest, moderation) |
| **ds-submissions** | the public repo players PR into; the ingest GitHub Action |

---

## 1. Automatic tests

Run these before every merge. All must be green.

### ds-leaderboard
```bash
cd ds-leaderboard
npm test            # vitest — 83 tests (receipt, storage, guilds, trial-sync)
npm run typecheck   # tsc --noEmit
npm run build       # next build — all routes compile, static pages generate
```
What the unit tests cover: receipt hash/verify, slug + invite-token rules, the
guild board queries, and **guild ownership** — creation cap, removeMember, leave +
auto-promote, setMemberRole, transferOwnership (each guard has a test).

### DragonSlayer (the game/CLI)
```bash
cd DragonSlayer
npm test            # vitest — engine, trials, leaderboard CLI, receipt sealing
npm run typecheck
npm run mutation    # stryker (optional, slow) — mutation testing on the vim engine
```

### ds-submissions (the Action)
The ingest workflow (`.github/workflows/ingest-receipt.yml`) runs automatically on
any PR touching `receipts/*.json`. It checks `handle == PR author`, the receipt
hash, and POSTs to the live `/api/ingest`. **Test it by opening a real PR** (see
§2.4) — there's no local unit test for the YAML itself.

> **Cache gotcha:** running `npm run build` while `npm run dev` is live corrupts the
> dev server's `.next` (you'll see `Cannot find module './NNN.js'` 500s). Fix:
> `rm -rf .next` and restart `npm run dev`. Run the prod build only when the dev
> server is stopped, or as a final check.

---

## 2. Manual tests (local, full stack)

Bring the backend up first (needs Podman/Docker):
```bash
cd ds-leaderboard
npm run dev:up      # local Supabase: Postgres + Auth + Storage + seed
npm run dev         # http://localhost:3000
```

### 2.1 Boards render (no sign-in)
- `/` — gold board, champion banner + ruled field, seeded rows.
- `/trials` → a trial (e.g. `/trials/t1-first-steps`) — speedrun board, champion =
  fastest, par-delta shown.
- `/guilds` → `/guilds/roundtable` — public guild board + roster.
- `/moderate` — the pending queue (reads past RLS via the service key).

### 2.2 Sign in locally (fake GitHub OAuth)
No GitHub OAuth app needed — use the dev login (see DEVELOPMENT.md):
```
http://localhost:3000/api/dev/login?as=captainnobody1
```
- as `captainnobody1` (owner of roundtable) → `/guilds/roundtable` shows the full
  owner controls (make mod / make owner / remove / abdicate).
- as `sirlintsalot` (a **mod**) → sees Manage + remove (members only), no make-owner.
- as `dame-refactor` (a plain **member**) → sees **leave** only.
- no cookie → no Manage column at all.

### 2.3 Guild ownership actions (signed in as owner)
On `/guilds/roundtable`, exercise each control and confirm the roster updates:
- **make mod** on the member, then **demote** it back.
- **make owner** (transfer) — confirm the badge flips and the old owner becomes mod.
- **remove** a member.
- **Abdicate & leave** as owner — confirm ownership auto-passes to the senior mod
  (and the guild disbands if you're the last one). _Tip: do this last, or on a
  throwaway guild you mustered via `/guilds/new`._

### 2.4 The submit pipe (CLI → ingest → moderate → board)
The real end-to-end. (PR is the only player path; locally we simulate the Action.)
```bash
# 1. seal a receipt in the game repo
cd DragonSlayer
npm run dev -- leaderboard whoami --set <your-handle>
npm run dev -- leaderboard receipt --out /tmp/run.json

# 2. POST it like the GitHub Action does
cd ../ds-leaderboard
SECRET=$(grep INGEST_SHARED_SECRET .env.local | cut -d= -f2)
payload=$(jq -nc --slurpfile r /tmp/run.json --arg a <your-handle> --arg u "https://example/pr/1" \
  '{receipt:$r[0], author:$a, receiptUrl:$u}')
curl -s -X POST localhost:3000/api/ingest -H "Authorization: Bearer $SECRET" \
  -H 'Content-Type: application/json' -d "$payload" -w '\nHTTP %{http_code}\n'
```
- Expect **HTTP 201**. An **empty** receipt (0 gold, no trials) ingests but creates
  no rows — play the practice-dungeon (`npm run dev:dungeon`) first for a real run.
- A receipt with gold/trials → a **pending** row. Verify it in `/moderate`, then
  **approve** it and confirm it appears on the public board.
- The player row is **auto-created** on first submit — no seeding needed.

### 2.5 Real submission PR (against live, after deploy)
Only once deployed: open a PR to `Soypete/ds-submissions` with a `receipts/*.json`
file → the Action runs → handle check → ingest → `/moderate` → approve → board.

---

## 3. Reset between runs
```bash
npm run dev:reset   # drop + replay migrations + reseed (wipes test data)
```

## 4. Pre-merge checklist
- [ ] ds-leaderboard: `npm test` + `npm run typecheck` + `npm run build` green
- [ ] DragonSlayer: `npm test` + `npm run typecheck` green
- [ ] Manual: boards render (§2.1)
- [ ] Manual: each role sees the right guild controls (§2.2–2.3)
- [ ] Manual: submit pipe lands a pending run and approval publishes it (§2.4)
- [ ] New migration (if any) applies via `npm run dev:reset`
