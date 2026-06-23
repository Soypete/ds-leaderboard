# Local development

How to run the Dragonslayer leaderboard with a **full local Supabase backend**
(Postgres + Storage + Auth + Studio) so you can iterate on the boards, the
moderator queue, and the ingest API against real data — no cloud project needed.

> The simpler path — `npm run dev` with no Supabase env — still works: the board
> pages render a "not configured" notice. Use that for pure UI work. Use the steps
> below when you need the backend.

## Prerequisites

- **Node 20+** (verified on v24) and npm. We run the Supabase CLI via `npx` — no
  global install required.
- A **container engine**: Docker *or* Podman. The Supabase CLI boots its services
  as containers.

### Podman vs. Docker

The Supabase CLI is built for Docker but talks to the daemon over a Docker-API
socket, which **Podman also exposes** — it just doesn't advertise the socket the
way the CLI expects. The `scripts/` helpers handle this for you:

- They detect whether `docker` is real Docker or a **Podman shim** (Podman ships a
  `docker` alias whose `--version` says "podman").
- For Podman they ensure the **podman machine** is running (macOS/Windows run
  Podman in a VM), resolve its socket, and export
  `DOCKER_HOST=unix://<socket>` for the CLI. On native Linux there's no machine
  step.

So on this machine (Podman 5.5.2, no Docker) you do **not** need to set anything
by hand — just make sure the podman machine is up:

```bash
podman machine start        # once per boot; no-op if already running
```

The detection/wiring lives in `scripts/lib.sh`, shared by all three scripts. If
you ever need to override it, export `DOCKER_HOST` yourself and the scripts will
respect it.

## Bring the stack up

```bash
./scripts/dev-up.sh          # or: npm run dev:up
```

First run pulls the Supabase container images (a few minutes). The script:

1. Ensures the container engine is reachable (starts the podman machine if needed).
2. Runs `npx supabase start` to boot Postgres, Storage, Auth, Realtime, and Studio.
3. Runs `npx supabase db reset` to apply `supabase/migrations/*.sql` **and** load
   `supabase/seed.sql` (the boards/queue test data). *We use `db reset` rather
   than `migration up` because reset is the supported way to load `seed.sql` — and
   locally a reset is cheap.*
4. Prints the connection details (`supabase status`).

It's **idempotent** — re-run it any time. (Re-running re-applies the seed via
`db reset`, so local edits to the DB are wiped; that's intentional for a seeded
dev DB. Use `--reset` explicitly if you want to be unambiguous.)

## Point the app at it

Copy the values `dev-up` prints into `.env.local` (start from `.env.example`):

| `supabase status` line | `.env.local` var |
|---|---|
| API URL | `NEXT_PUBLIC_SUPABASE_URL` |
| anon key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| service_role key | `SUPABASE_SERVICE_ROLE_KEY` |

The local anon/service keys are **the same on every machine**, so you paste them
once. Also set `MODERATOR_HANDLES=captainnobody1` (the seeded moderator) and any
`INGEST_SHARED_SECRET` you like for local ingest testing.

```bash
cp .env.example .env.local   # if you haven't already
# edit .env.local with the values above
```

## Run the app

```bash
npm run dev                  # http://localhost:3000
```

- Gold board: shows the **approved** seeded runs.
- `/moderate`: shows the **pending** seeded runs (reads past RLS via the service key).

## Sign in locally (fake GitHub session)

GitHub OAuth needs a real OAuth app, which we don't wire up locally. To test the
signed-in paths — guild ownership controls, private boards, moderator powers —
without github.com, use the **dev login route**:

```
http://localhost:3000/api/dev/login?as=captainnobody1
```

It mints (or reuses) a Supabase Auth user whose `user_metadata.user_name` is the
handle you pass — the exact shape the real GitHub provider produces — signs in to
get a genuine session, and sets the same `sb-<ref>-auth-token` cookie the real
OAuth callback writes. Every downstream check then runs for real
(`currentUser` → `githubIdentityFromUser` → `currentPlayer` → guild roles).

- Default handle is `captainnobody1` (the seeded **owner** of the `roundtable`
  guild) — sign in as them, open `/guilds/roundtable`, and you'll see the full
  owner control set (make mod / make owner / remove / abdicate).
- Pass `?as=<handle>` to be anyone, e.g. `?as=sirlintsalot` (a **mod** of
  roundtable — sees remove only) or `?as=dame-refactor` (a plain **member** —
  sees leave only). Handy for checking the role gating from each side.
- For a seeded handle the route **reuses that player's `github_id`**, so the
  session resolves to the existing player row (and its guild ownership) rather
  than forking a new one.

**Safety:** the route is hard-gated — it returns `403` unless `NODE_ENV` is not
`production` AND the Supabase URL points at `127.0.0.1`/`localhost`. It can never
forge a session against a hosted project, so it's safe to keep in the tree.
To sign out, clear the `sb-…-auth-token` cookie for `localhost` (or use a private
window).

## Studio (browse / query the DB)

Open the **Studio URL** from `dev-up` output — `http://127.0.0.1:54323`. Browse
tables, inspect the `ds-media` Storage bucket, and run ad-hoc SQL.

## Reset to a clean, seeded database

```bash
./scripts/dev-reset.sh       # or: npm run dev:reset
```

Drops the DB, replays migrations, reloads `seed.sql`. The stack stays up; only the
database is rebuilt.

## Stop the stack

```bash
./scripts/dev-down.sh        # or: npm run dev:down
```

The local database volume is **preserved** by default, so the next `dev-up` brings
your data back. To wipe it on stop:

```bash
./scripts/dev-down.sh --no-backup
```

## What's seeded

`supabase/seed.sql` loads, against the schema in
`supabase/migrations/0001_init.sql`:

- **4 players** (`captainnobody1` is the seeded moderator).
- One **public guild** (`roundtable`) with members — exercises the public-guild
  RLS path.
- A small **trials** catalog (tiers 1/3/5/7).
- **daily_gold_runs**: approved (global + public-guild), pending (the queue), and
  one rejected (audit trail).
- **trial_runs**: approved across two trials + one pending.
- **media_assets** (screenshots + a video) and **verification_events** (one
  approval, one rejection).

## Troubleshooting

- **"No container engine found" / daemon unreachable** — start Podman:
  `podman machine start`. Confirm with `podman info`.
- **Port already in use** — another Supabase stack is running, or the ports in
  `supabase/config.toml` (54321–54324) clash. Stop the other stack or change the
  ports.
- **Images won't pull** — Podman needs network + a running machine. Try
  `podman machine restart`.
- **Stuck containers after a crash** — `./scripts/dev-down.sh` then `dev-up`
  again. As a last resort, `npx supabase stop --no-backup`.
