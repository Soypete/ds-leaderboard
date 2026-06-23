# Next session — plan & state

_Snapshot as of 2026-06-23. Pick up here._

## Where things stand

- **ds-leaderboard** branch `leaderboard-full` — pushed to origin. Three commits:
  redesign, guild ownership, docs/dev-login/media-migration. Working tree clean.
  `npm test` (83) + `typecheck` + `build` all green.
- **DragonSlayer** and **ds-submissions** — clean, untouched.
- **Local stack**: `npm run dev:up` brings up Supabase; `npm run dev` serves on :3000.
  Fake sign-in via `/api/dev/login?as=<handle>` (DEVELOPMENT.md).
- **GitHub issues** (Soypete/ds-leaderboard): #6 master checklist; #2 guild
  ownership, #3 submit pipe, #4 dev-login, #5 media (the build).

## Built & tested
- Board redesign (illuminated-ledger; champion banner; Soypete Tech footer).
- Guild ownership: cap (5), remove, leave + owner auto-promote, roles, transfer —
  logic + 15 tests + role-gated roster UI.
- Local OAuth emulation via the hard-gated dev-login route.
- Submit pipe proven locally end-to-end (CLI receipt → /api/ingest → pending).

## NOT built yet — the queued work (issue #5)

**Require media on submissions + two human approval gates.** Full plan:
`/Users/soypete/.claude/plans/require-submission-media.md`. Decisions already made:
- trial → requires a **video** URL; gold → requires an **image** URL.
- Enforce in **both** the Action (PR-time) and `/api/ingest` (backstop + future CLI).
- **Gate 1**: CODEOWNERS (`receipts/* @captainnobody1`) + branch protection on
  ds-submissions (apply via `gh api`).
- **Gate 2**: the moderation queue (already built — board filters status='approved').
- Approvers = existing `MODERATOR_HANDLES` + guild owner/mod roles.

To do:
- [ ] migration 0004 already exists (media_url on both run tables) — wire it up.
- [ ] `ingestReceipt`: media arg; reject gold-without-image / trial-without-video
      (422); store `media_url`. Tests for each case.
- [ ] `/api/ingest`: parse `goldMediaUrl` + `trialMediaUrls`.
- [ ] ds-submissions Action: parse PR body for media, fail with a comment if missing,
      pass URLs through. README update.
- [ ] CODEOWNERS file + branch protection via `gh api`.

## Other open threads (decided, not built)
- **CLI direct submit** via GitHub OAuth **device flow** (so the CLI can submit
  without a PR). Needs a public submit endpoint. PR path stays. (Decided: device flow.)
- **Deploy** (all deferred): Supabase project + migrations + ds-media bucket; Vercel
  + env; real GitHub OAuth app; ds-submissions secrets. Runbook: HOSTING.md.
- **@supabase/ssr** swap for durable sessions (auth.ts / auth callback are minimal
  hand-rolled cookie seams) — user wanted this "before launch".
- 6 Dependabot advisories on the repo (1 critical) — triage.

## Suggested first move next session
Build issue #5 (media required) — it's fully planned, decisions locked, migration
already in place. Then CLI device-flow submit, then deploy.
