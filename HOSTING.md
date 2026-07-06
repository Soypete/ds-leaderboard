# Hosting & cost plan

Target: **≤ $20/month** at small scale, ideally **$0** until media volume forces a step up.

## The stack

| Concern | Choice | Cost at small scale |
|---|---|---|
| Web app + API | **Next.js (App Router) on Vercel Hobby** | $0 |
| Database | **Supabase Postgres** (free tier) | $0 (Pro is $25 — the cliff to avoid) |
| Media storage | **Supabase Storage** (S3-compatible) | $0 within free quotas |
| Receipt ingest compute | **GitHub Actions** in a public submissions repo | $0 |
| Auth (later) | **GitHub OAuth via Supabase Auth** | $0 |

Everything lives in **one Supabase project** (Postgres + Storage), so there's one
dashboard, one bill, one set of keys. Supabase Storage speaks the S3 API, so the
presigned-URL upload + CORS pattern below is the same one you'd use with raw AWS S3 —
we just don't run a second cloud account.

## Why this fits the budget

The only real cost driver is **video**. Screenshots are kilobytes and effectively free.
Postgres rows are tiny. So the plan is:

1. **MVP = gold board + screenshots.** No video, no transcoding → comfortably free.
2. **Phase 2 video** prefers **external links** (YouTube/Streamable unlisted) — zero stored
   bytes — and only falls back to stored+compressed video when a link won't do.
3. If we ever store video: compress in the GitHub Action *before* upload
   (`ffmpeg -vf scale=-2:720 -c:v libx264 -crf 28 -preset veryfast -c:a aac -b:a 96k`, ≤60s),
   cap per-run size, dedupe by hash, expire rejected media, and keep media only for top-N
   runs per trial. These keep storage under the free quota; Supabase Pro ($25) is the cliff.

## Media uploads — S3-style presigned URLs + CORS

The browser never holds the service key. Upload flow:

1. Client asks the app (server route, service key) for a **presigned upload URL** scoped to
   one object key in the `ds-media` bucket.
2. Browser `PUT`s the file directly to Supabase Storage at that URL.
3. Client tells the app the upload finished; the app records a `media_assets` row.

**CORS** must allow the `PUT` from the site origin. In the Supabase dashboard:
*Storage → the `ds-media` bucket → CORS configuration*:

```json
[
  {
    "allowedOrigins": ["https://YOUR-APP.vercel.app", "http://localhost:3000"],
    "allowedMethods": ["GET", "PUT", "HEAD"],
    "allowedHeaders": ["*"],
    "maxAgeSeconds": 3600
  }
]
```

Screenshot bucket is public-read (so boards can show the image); uploads are always gated
through presigned URLs. (Presigned-URL minting is a Phase-2 build item — the bucket + CORS
are the standing config it depends on.)

## Deploy steps

### 1. Supabase
1. Create a project (free tier). Note the **Project URL**, **anon key**, **service-role key**.
2. Apply the schema: `supabase db push` (or paste `supabase/migrations/0001_init.sql` into the
   SQL editor).
3. Create a Storage bucket `ds-media` (public). Set the CORS JSON above.

### 2. Vercel
1. Import this repo. Framework preset: **Next.js**.
2. Set env vars (from `.env.example`):
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server only — do NOT prefix with `NEXT_PUBLIC_`)
   - `INGEST_SHARED_SECRET` (a long random string)
   - `MODERATOR_HANDLES` (comma-separated, lowercased)
3. Deploy. The gold board renders with ISR (60s); `/moderate` is dynamic.

### 3. Submissions repo (GitHub-based ingest)
1. Fork (or recreate) the public [ds-submissions](https://github.com/Soypete/ds-submissions)
   repo — it carries the two-stage workflows and the receipt validator.
2. Add repo secrets: `INGEST_URL` (`https://YOUR-APP.vercel.app/api/ingest`) and
   `INGEST_SHARED_SECRET` (same value as Vercel).
3. Players run `gme leaderboard receipt --out receipts/<handle>-<day>.json` and open a PR.
   Validation runs on the PR with no secrets (fork-safe: schema, contentHash,
   filename, handle == PR author); after a maintainer merges, the
   `ingest-on-merge` workflow POSTs to `/api/ingest` and the run lands pending.

## Self-host (your own boards)

Two supported paths, documented in [`self-host/README.md`](self-host/README.md):
your own Supabase project (free tier) + the app container, or Supabase's
official self-hosted stack for fully on-prem. A raw Postgres + MinIO stack
without Supabase is **not** supported — the app's data/storage/auth layers are
Supabase-client only; an adapter would be a future enhancement tracked in issues.

## Cost ceiling & mitigations

- **Free** through the MVP (screenshots only).
- First paid pressure is **video storage/egress** → external links first, then compressed
  stored video with caps and lifecycle expiry.
- Avoid Supabase Pro ($25) until traffic genuinely needs it; nothing in the MVP does.
