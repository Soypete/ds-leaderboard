-- Local seed data for the Dragonslayer leaderboard.
--
-- Loaded by `supabase db reset` (configured in supabase/config.toml under
-- [db.seed]). Gives the gold board, the per-trial boards, and the moderator queue
-- something real to render while iterating locally. NOT for production.
--
-- Every column/enum here matches supabase/migrations/0001_init.sql. Writes here
-- run as the superuser during reset, so RLS does not get in the way of seeding;
-- the *app* still reads through RLS, which is why we include both approved rows
-- (visible to the anon board) and pending rows (visible only to the moderator
-- queue via the service key).
--
-- Idempotent: re-runnable on its own thanks to ON CONFLICT guards, though
-- `db reset` already starts from an empty schema each time.

-- ── Players ───────────────────────────────────────────────────────────────────
-- Fixed UUIDs so seed rows cross-reference cleanly and stay stable across resets.
insert into players (id, github_handle, github_id, created_at) values
  ('11111111-1111-1111-1111-111111111111', 'captainnobody1', 1001, now() - interval '90 days'),
  ('22222222-2222-2222-2222-222222222222', 'sirlintsalot',   1002, now() - interval '60 days'),
  ('33333333-3333-3333-3333-333333333333', 'dame-refactor',  1003, now() - interval '45 days'),
  ('44444444-4444-4444-4444-444444444444', 'novice-knight',  1004, now() - interval '7 days')
on conflict (github_handle) do nothing;

-- ── A public guild + membership (exercises the public-guild RLS path) ─────────
insert into guilds (id, slug, name, is_private, owner_id, created_at) values
  ('a0000000-0000-0000-0000-000000000001', 'roundtable', 'Knights of the Round Table', false,
   '11111111-1111-1111-1111-111111111111', now() - interval '50 days')
on conflict (slug) do nothing;

insert into guild_members (guild_id, player_id, role) values
  ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('a0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'mod'),
  ('a0000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'member')
on conflict (guild_id, player_id) do nothing;

-- ── Trial catalog (a handful, synced shape from the game) ─────────────────────
insert into trials (id, tier, title, par, game_version) values
  ('t1-first-steps',          1, 'First Steps in the Realm',        12, '0.1.0'),
  ('t3-echo-the-incantation', 3, 'Echo the Incantation',            24, '0.1.0'),
  ('t5-slay-the-line-wyrm',   5, 'Slay the Line-Wyrm',              40, '0.1.0'),
  ('t7-the-paragraph-gauntlet',7, 'The Paragraph Gauntlet',         66, '0.1.0')
on conflict (id) do nothing;

-- ── Board 1: gold earned in a day ─────────────────────────────────────────────
-- A mix of statuses + a public-guild run so the board, the guild filter, and the
-- moderator queue all have data. The anon board should show only the APPROVED,
-- global-or-public-guild rows.
insert into daily_gold_runs
  (id, player_id, guild_id, day, gold, game_version, repo_sigil, receipt_hash, receipt_url, status, submitted_at) values
  -- Approved, global — top of the board.
  ('d0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', null,
   current_date - 1, 4200, '0.1.0', 'sigil:dragonslayer:main',
   'sha256:aaa1111111111111111111111111111111111111111111111111111111111111',
   'https://example.com/receipts/captainnobody1-day1.json', 'approved', now() - interval '1 day'),
  -- Approved, public guild — should also be visible to anon.
  ('d0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'a0000000-0000-0000-0000-000000000001',
   current_date - 1, 3100, '0.1.0', 'sigil:dragonslayer:main',
   'sha256:bbb2222222222222222222222222222222222222222222222222222222222222',
   'https://example.com/receipts/sirlintsalot-day1.json', 'approved', now() - interval '1 day'),
  -- Approved, global, different day.
  ('d0000000-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333', null,
   current_date - 2, 2750, '0.1.0', 'sigil:dragonslayer:main',
   'sha256:ccc3333333333333333333333333333333333333333333333333333333333333',
   'https://example.com/receipts/dame-refactor-day2.json', 'approved', now() - interval '2 days'),
  -- PENDING — should appear in the moderator queue, not on the public board.
  ('d0000000-0000-0000-0000-000000000004', '44444444-4444-4444-4444-444444444444', null,
   current_date, 1500, '0.1.0', 'sigil:dragonslayer:main',
   'sha256:ddd4444444444444444444444444444444444444444444444444444444444444',
   'https://example.com/receipts/novice-knight-today.json', 'pending', now()),
  -- PENDING — second item for the queue.
  ('d0000000-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222', null,
   current_date, 3900, '0.1.0', 'sigil:dragonslayer:main',
   'sha256:eee5555555555555555555555555555555555555555555555555555555555555',
   'https://example.com/receipts/sirlintsalot-today.json', 'pending', now()),
  -- REJECTED — exercises the rejected path / audit trail.
  ('d0000000-0000-0000-0000-000000000006', '44444444-4444-4444-4444-444444444444', null,
   current_date - 3, 9999, '0.1.0', 'sigil:dragonslayer:main',
   'sha256:fff6666666666666666666666666666666666666666666666666666666666666',
   'https://example.com/receipts/novice-knight-suspicious.json', 'rejected', now() - interval '3 days')
on conflict (player_id, day, repo_sigil) do nothing;

-- ── Board 2: per-trial vim speedruns ──────────────────────────────────────────
insert into trial_runs
  (id, player_id, guild_id, trial_id, duration_ms, keystrokes, par, stars, completed_at,
   game_version, receipt_hash, receipt_url, status, submitted_at) values
  -- Approved trial runs across two trials.
  ('70000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', null,
   't1-first-steps', 8400, 11, 12, 3, now() - interval '2 days',
   '0.1.0', 'sha256:run11111111111111111111111111111111111111111111111111111111',
   'https://example.com/videos/captainnobody1-t1.mp4', 'approved', now() - interval '2 days'),
  ('70000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', null,
   't1-first-steps', 9900, 14, 12, 2, now() - interval '2 days',
   '0.1.0', 'sha256:run22222222222222222222222222222222222222222222222222222222',
   'https://example.com/videos/sirlintsalot-t1.mp4', 'approved', now() - interval '2 days'),
  ('70000000-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333', null,
   't3-echo-the-incantation', 21000, 23, 24, 3, now() - interval '1 day',
   '0.1.0', 'sha256:run33333333333333333333333333333333333333333333333333333333',
   'https://example.com/videos/dame-refactor-t3.mp4', 'approved', now() - interval '1 day'),
  -- PENDING trial run for the moderator queue.
  ('70000000-0000-0000-0000-000000000004', '44444444-4444-4444-4444-444444444444', null,
   't1-first-steps', 15000, 31, 12, 1, now(),
   '0.1.0', 'sha256:run44444444444444444444444444444444444444444444444444444444',
   'https://example.com/videos/novice-knight-t1.mp4', 'pending', now())
on conflict (id) do nothing;

-- ── Media assets (Storage keys in the ds-media bucket) ────────────────────────
-- Screenshots back gold runs; videos back trial runs. Exactly one run fk each
-- (enforced by the table's xor check).
insert into media_assets (id, kind, storage_path, byte_size, daily_run_id, trial_run_id, uploaded_by) values
  ('e0000000-0000-0000-0000-000000000001', 'screenshot', 'ds-media/gold/captainnobody1-day1.png', 184320,
   'd0000000-0000-0000-0000-000000000001', null, '11111111-1111-1111-1111-111111111111'),
  ('e0000000-0000-0000-0000-000000000002', 'screenshot', 'ds-media/gold/sirlintsalot-day1.png', 201728,
   'd0000000-0000-0000-0000-000000000002', null, '22222222-2222-2222-2222-222222222222'),
  ('e0000000-0000-0000-0000-000000000003', 'screenshot', 'ds-media/gold/novice-knight-today.png', 175104,
   'd0000000-0000-0000-0000-000000000004', null, '44444444-4444-4444-4444-444444444444'),
  ('e0000000-0000-0000-0000-000000000004', 'video', 'ds-media/trials/captainnobody1-t1.mp4', 4194304,
   null, '70000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111')
on conflict (id) do nothing;

-- ── Moderation audit trail ────────────────────────────────────────────────────
-- One approval and one rejection so the audit view / history has entries.
insert into verification_events (id, daily_run_id, trial_run_id, moderator_id, action, note, created_at) values
  ('c0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', null,
   '11111111-1111-1111-1111-111111111111', 'approved', 'Screenshot verified — clean haul.', now() - interval '1 day'),
  ('c0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000006', null,
   '11111111-1111-1111-1111-111111111111', 'rejected', 'Gold total impossible for game_version 0.1.0.', now() - interval '3 days')
on conflict (id) do nothing;
