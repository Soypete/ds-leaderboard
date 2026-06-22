# Self-hosting the Dragonslayer leaderboard

For teams who want the boards on their own infrastructure instead of the hosted
Supabase + Vercel deployment. Same app, same schema — the storage and auth
layers swap to local equivalents.

## What runs

`docker compose` (or `podman compose`) brings up three services:

- **db** — Postgres 16. The `supabase/migrations/*.sql` files are applied in
  order on first boot (the same migrations the hosted deployment uses).
- **minio** — S3-compatible object storage for media, in place of Supabase
  Storage. A one-shot `minio-init` creates the `ds-media` bucket.
- **app** — the Next.js leaderboard, built from `self-host/Dockerfile`.

## Quick start

```bash
cd self-host
cp .env.selfhost.example .env     # fill in secrets
docker compose up -d              # or: podman compose up -d
# open http://localhost:3000  (MinIO console: http://localhost:9001)
```

## What works fully vs. what needs more

- **Fully self-hosted:** the gold-per-day board, per-trial speedrun boards,
  receipt ingest (POST to `/api/ingest` with `INGEST_SHARED_SECRET`), the
  trial-catalog sync, moderation (approve/reject with the media gate), and media
  upload to MinIO.
- **Needs a decision:** guild **sign-in** uses GitHub OAuth via Supabase Auth.
  On-prem you either (a) point at a reachable Supabase Auth instance, or (b) run
  the documented "one guild = the whole instance, no per-user auth" mode where
  the shared secret gates moderation and everyone shares one board. The boards
  themselves don't require auth; only private-guild membership does.

## Differences from the hosted setup

| Concern | Hosted | Self-host |
|---|---|---|
| Database | Supabase Postgres | Postgres container |
| Media storage | Supabase Storage | MinIO (S3 API) |
| Auth | Supabase Auth + GitHub OAuth | reachable Supabase Auth, or no-auth single-guild mode |
| App host | Vercel | the `app` container |

The schema (`supabase/migrations/`) and all application code are identical — only
environment wiring differs, so updates flow to both deployments from one codebase.

## Notes

- The `app` image uses Next.js `output: 'standalone'` (set in `next.config.mjs`).
- Postgres only runs the init migrations on an **empty** data volume. To re-apply
  after schema changes, either add new numbered migration files (they won't
  re-run automatically — apply them with `psql`) or `docker compose down -v` to
  wipe and re-init (destroys data).
- For real deployments, change every default password in `.env`.
