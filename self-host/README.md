# Self-hosting the Dragonslayer leaderboard

For anyone who wants their own boards instead of (or alongside) the hosted
Supabase + Vercel deployment. The app talks to **Supabase** — database, storage,
and auth all go through the Supabase client. Self-hosting means bringing your
own Supabase backend and running the app container against it.

## The two supported paths

### Path A — your own Supabase project (easiest)

1. Create a project at [supabase.com](https://supabase.com) (free tier is fine
   through the MVP).
2. Apply the schema: `supabase link --project-ref <your-ref>` then
   `supabase db push` (applies `supabase/migrations/*.sql` in order).
3. Create the media bucket named in `SUPABASE_MEDIA_BUCKET` (default
   `ds-media`) via Studio → Storage.
4. Run the app anywhere Node 22 runs — Vercel (see `HOSTING.md`), or the
   container below — with the env vars from `.env.example`.

### Path B — fully on-prem with self-hosted Supabase

Run Supabase's official self-hosted stack
([supabase.com/docs/guides/self-hosting](https://supabase.com/docs/guides/self-hosting)
— their docker-compose bundles Postgres, Auth, Storage, and the API gateway),
then treat it exactly like Path A: apply the migrations, create the bucket,
point the app's env vars at your gateway URL and keys.

## Running the app container

`self-host/Dockerfile` builds a standalone Next.js image (uses
`output: 'standalone'` from `next.config.mjs`):

```bash
docker build -f self-host/Dockerfile -t ds-leaderboard .
docker run -p 3000:3000 --env-file .env ds-leaderboard
```

Required env (see `.env.example` for the full commentary):

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server only)
- `INGEST_SHARED_SECRET` (a long random string; mirror it into your
  submissions repo's Actions secrets)
- `SUPABASE_MEDIA_BUCKET`, `NEXT_PUBLIC_SUPABASE_MEDIA_BUCKET`
- `MODERATOR_HANDLES` (comma-separated, lowercased — your handle, not the
  upstream default)

## Wiring your own submission flow

Fork [ds-submissions](https://github.com/Soypete/ds-submissions) and set its
two Actions secrets — `INGEST_URL` (your `/api/ingest`) and
`INGEST_SHARED_SECRET`. PR validation needs no secrets; only the post-merge
ingest workflow uses them.

## What about a raw Postgres + MinIO stack (no Supabase)?

Not supported. The app's data, storage, and auth layers use the Supabase
client exclusively — a `DATABASE_URL`/S3 adapter would be new code, tracked as
a future enhancement in the repo's issues. If you need on-prem today, Path B
(self-hosted Supabase) is the supported route.
