-- Dragonslayer leaderboard — ALL migrations combined (0001 → 0004).
-- Paste this whole file into the Supabase SQL editor of a FRESH project and run it.
-- Generated from supabase/migrations/*.sql — keep those as the source of truth.

-- ═══════════════════════════════════════════════════════════════════════════
-- 0001_init.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- Dragonslayer leaderboard — initial schema.
--
-- Apply with the Supabase CLI (`supabase db push`) or paste into the SQL editor.
-- RLS is ON for every table: the browser (anon key) sees only approved rows and
-- public guilds; all writes go through the service-role key in server routes.

-- Everything lives in the `public` schema — the app's supabase-js clients query
-- the default schema, and PostgREST exposes `public` out of the box. (An earlier
-- revision tried a dedicated `ds_leaderboard` schema here; the statement was
-- invalid SQL and never took effect, so `public` is the schema of record.)

-- ── Extensions ────────────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";  -- gen_random_uuid()

-- ── Enums ─────────────────────────────────────────────────────────────────────
do $$ begin
  create type verification_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type media_kind as enum ('screenshot', 'video');
exception when duplicate_object then null; end $$;

do $$ begin
  create type guild_role as enum ('owner', 'mod', 'member');
exception when duplicate_object then null; end $$;

-- ── Players ───────────────────────────────────────────────────────────────────
create table if not exists players (
  id            uuid primary key default gen_random_uuid(),
  github_handle text unique not null,          -- lowercased
  github_id     bigint unique,                 -- immutable GitHub id, survives renames
  created_at    timestamptz not null default now()
);

-- ── Guilds (teams / tenants) ──────────────────────────────────────────────────
create table if not exists guilds (
  id         uuid primary key default gen_random_uuid(),
  slug       text unique not null,
  name       text not null,
  is_private boolean not null default true,
  owner_id   uuid references players(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists guild_members (
  guild_id  uuid not null references guilds(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  role      guild_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (guild_id, player_id)
);

create table if not exists guild_invites (
  id         uuid primary key default gen_random_uuid(),
  guild_id   uuid not null references guilds(id) on delete cascade,
  token      text unique not null,
  email      text,
  expires_at timestamptz,
  used_by    uuid references players(id) on delete set null
);

-- ── Trial catalog (synced from the game) ──────────────────────────────────────
create table if not exists trials (
  id           text primary key,               -- 't3-echo-the-incantation'
  tier         smallint not null,
  title        text not null,
  par          integer not null,
  game_version text not null
);

-- ── Board 1: gold earned in a day ─────────────────────────────────────────────
create table if not exists daily_gold_runs (
  id           uuid primary key default gen_random_uuid(),
  player_id    uuid not null references players(id) on delete cascade,
  guild_id     uuid references guilds(id) on delete set null,  -- null = global only
  day          date not null,
  gold         integer not null check (gold >= 0),
  game_version text not null,
  repo_sigil   text not null,
  receipt_hash text not null,
  receipt_url  text,
  status       verification_status not null default 'pending',
  submitted_at timestamptz not null default now(),
  unique (player_id, day, repo_sigil)          -- one canonical run per player/day/realm
);

-- ── Board 2: per-trial vim speedruns ──────────────────────────────────────────
create table if not exists trial_runs (
  id           uuid primary key default gen_random_uuid(),
  player_id    uuid not null references players(id) on delete cascade,
  guild_id     uuid references guilds(id) on delete set null,
  trial_id     text not null references trials(id),
  duration_ms  integer not null check (duration_ms > 0),
  keystrokes   integer not null,
  par          integer not null,
  stars        smallint not null,
  completed_at timestamptz,
  game_version text not null,
  receipt_hash text not null,
  receipt_url  text,
  status       verification_status not null default 'pending',
  submitted_at timestamptz not null default now()
);

-- ── Media (Supabase Storage keys) ─────────────────────────────────────────────
create table if not exists media_assets (
  id           uuid primary key default gen_random_uuid(),
  kind         media_kind not null,
  storage_path text not null,                  -- bucket key
  byte_size    bigint,
  daily_run_id uuid references daily_gold_runs(id) on delete cascade,
  trial_run_id uuid references trial_runs(id) on delete cascade,
  uploaded_by  uuid references players(id) on delete set null,
  created_at   timestamptz not null default now(),
  -- exactly one of the two run fks must be set
  check ((daily_run_id is not null) <> (trial_run_id is not null))
);

-- ── Moderation audit trail ────────────────────────────────────────────────────
create table if not exists verification_events (
  id           uuid primary key default gen_random_uuid(),
  daily_run_id uuid references daily_gold_runs(id) on delete cascade,
  trial_run_id uuid references trial_runs(id) on delete cascade,
  moderator_id uuid references players(id) on delete set null,
  action       verification_status not null,   -- approved | rejected
  note         text,
  created_at   timestamptz not null default now()
);

-- ── Indexes for board ranking ─────────────────────────────────────────────────
create index if not exists idx_gold_board on daily_gold_runs (day, status, gold desc);
create index if not exists idx_gold_guild on daily_gold_runs (guild_id) where guild_id is not null;
create index if not exists idx_trial_board on trial_runs (trial_id, status, duration_ms, keystrokes);
create index if not exists idx_trial_guild on trial_runs (guild_id) where guild_id is not null;

-- ── Row-level security ────────────────────────────────────────────────────────
-- Reads: the anon role sees approved rows that are global (guild_id is null) or
-- belong to a public guild. Private-guild rows and pending/rejected runs are
-- invisible to the browser; the moderator queue reads them via the service key.
-- Writes: no anon writes at all — ingest and moderation use the service role,
-- which bypasses RLS.

alter table players enable row level security;
alter table guilds enable row level security;
alter table guild_members enable row level security;
alter table guild_invites enable row level security;
alter table trials enable row level security;
alter table daily_gold_runs enable row level security;
alter table trial_runs enable row level security;
alter table media_assets enable row level security;
alter table verification_events enable row level security;

-- Public read of player handles (needed to render board names).
create policy "players are public" on players for select using (true);

-- Public read of the trial catalog and public guild metadata.
create policy "trials are public" on trials for select using (true);
create policy "public guilds are visible" on guilds
  for select using (is_private = false);

-- Approved + global (or public-guild) runs are world-readable.
create policy "approved global gold runs are public" on daily_gold_runs
  for select using (
    status = 'approved'
    and (
      guild_id is null
      or exists (select 1 from guilds g where g.id = guild_id and g.is_private = false)
    )
  );

create policy "approved global trial runs are public" on trial_runs
  for select using (
    status = 'approved'
    and (
      guild_id is null
      or exists (select 1 from guilds g where g.id = guild_id and g.is_private = false)
    )
  );

-- Media tied to a publicly-visible run is readable (the run policy gates it).
create policy "media for visible gold runs" on media_assets
  for select using (
    daily_run_id is not null
    and exists (select 1 from daily_gold_runs r where r.id = daily_run_id)
  );
create policy "media for visible trial runs" on media_assets
  for select using (
    trial_run_id is not null
    and exists (select 1 from trial_runs r where r.id = trial_run_id)
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- 0002_guild_rls.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- Dragonslayer leaderboard — Phase 3 RLS: member-scoped reads of PRIVATE guilds.
--
-- 0001_init.sql made PUBLIC guilds (and their approved runs) world-readable, but
-- left private guilds invisible to everyone except the service role. This
-- migration grants authenticated members SELECT on their own private guild's
-- rows, using Supabase Auth's `auth.uid()`.
--
-- ── Identity assumption ───────────────────────────────────────────────────────
-- `auth.uid()` is the Supabase Auth user id (from `auth.users`), which is NOT the
-- same as our `players.id`. We bridge the two through the GitHub identity that
-- the OAuth login carries:
--   * `auth.users.raw_user_meta_data->>'user_name'`  = the GitHub login (handle)
--   * `players.github_handle`                         = the same handle, lowercased
-- The app upserts the players row with the lowercased handle on login (see
-- src/lib/auth.ts `upsertPlayer`), so the join below lowercases the auth handle
-- to match. A production hardening would store `players.auth_user_id uuid` and
-- join on that directly; we avoid editing 0001 / db.ts here and keep the bridge
-- in a SQL helper so the policies stay readable.
--
-- All policies are SELECT-only and additive (Postgres RLS is permissive: a row
-- is visible if ANY policy allows it), so the existing public policies keep
-- working and these only widen visibility for authenticated members.

-- ── Helper: the players row(s) for the current auth user ──────────────────────
-- Returns the player id(s) whose github_handle matches the signed-in GitHub
-- login. SECURITY DEFINER so it can read auth.users + players regardless of the
-- caller's own RLS. STABLE: depends only on the current auth context.
create or replace function public.current_player_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from players p
  join auth.users u on u.id = auth.uid()
  where lower(coalesce(
          u.raw_user_meta_data->>'user_name',
          u.raw_user_meta_data->>'preferred_username',
          u.raw_user_meta_data->>'nickname'
        )) = lower(p.github_handle)
$$;

revoke all on function public.current_player_ids() from public;
grant execute on function public.current_player_ids() to authenticated, anon;

-- ── Guilds: a member can see their (private) guild's metadata ──────────────────
create policy "members read their guild" on guilds
  for select using (
    exists (
      select 1
      from guild_members m
      where m.guild_id = guilds.id
        and m.player_id in (select public.current_player_ids())
    )
  );

-- ── Guild members: a member can see the roster of guilds they belong to ───────
create policy "members read their guild roster" on guild_members
  for select using (
    exists (
      select 1
      from guild_members self
      where self.guild_id = guild_members.guild_id
        and self.player_id in (select public.current_player_ids())
    )
  );

-- ── Daily gold runs: approved runs in a guild the caller is a member of ───────
-- (Pending/rejected stay service-role-only, matching the global board's stance.)
create policy "members read their guild gold runs" on daily_gold_runs
  for select using (
    status = 'approved'
    and guild_id is not null
    and exists (
      select 1
      from guild_members m
      where m.guild_id = daily_gold_runs.guild_id
        and m.player_id in (select public.current_player_ids())
    )
  );

-- ── Trial runs: approved runs in a guild the caller is a member of ────────────
create policy "members read their guild trial runs" on trial_runs
  for select using (
    status = 'approved'
    and guild_id is not null
    and exists (
      select 1
      from guild_members m
      where m.guild_id = trial_runs.guild_id
        and m.player_id in (select public.current_player_ids())
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- 0003_fix_guild_rls_recursion.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- Dragonslayer leaderboard — fix infinite recursion in the guild_members RLS
-- policy, and grant the API roles SELECT on the readable tables.
--
-- ── Bug 1: infinite recursion (Postgres 42P17) ───────────────────────────────
-- 0002's "members read their guild roster" policy on guild_members had a USING
-- clause that itself SELECTs from guild_members. Evaluating a SELECT policy ON a
-- table by querying that SAME table re-triggers the policy → infinite recursion.
-- Because other tables' policies also reference guild_members, the recursion
-- poisoned anon reads of daily_gold_runs (the public gold board broke).
--
-- Fix: route the membership lookup through a SECURITY DEFINER helper that reads
-- guild_members with RLS bypassed, so the policy never re-enters its own table.

-- The set of guild ids the current auth user belongs to. SECURITY DEFINER →
-- reads guild_members without invoking RLS, breaking the recursion cycle.
create or replace function public.current_guild_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.guild_id
  from guild_members m
  where m.player_id in (select public.current_player_ids())
$$;

revoke all on function public.current_guild_ids() from public;
grant execute on function public.current_guild_ids() to authenticated, anon;

-- Replace the recursive policy with one that uses the helper.
drop policy if exists "members read their guild roster" on guild_members;
create policy "members read their guild roster" on guild_members
  for select using (
    guild_id in (select public.current_guild_ids())
  );

-- The guilds-metadata and run policies from 0002 already avoid recursion (they
-- query guild_members from a DIFFERENT table's policy, which is fine), but we
-- simplify them to the helper too for consistency and one fewer planner join.
drop policy if exists "members read their guild" on guilds;
create policy "members read their guild" on guilds
  for select using (
    id in (select public.current_guild_ids())
  );

drop policy if exists "members read their guild gold runs" on daily_gold_runs;
create policy "members read their guild gold runs" on daily_gold_runs
  for select using (
    status = 'approved'
    and guild_id is not null
    and guild_id in (select public.current_guild_ids())
  );

drop policy if exists "members read their guild trial runs" on trial_runs;
create policy "members read their guild trial runs" on trial_runs
  for select using (
    status = 'approved'
    and guild_id is not null
    and guild_id in (select public.current_guild_ids())
  );

-- ── Bug 2: PostgREST "permission denied" ─────────────────────────────────────
-- RLS decides WHICH rows are visible, but the API roles still need table-level
-- SELECT privilege or PostgREST returns "permission denied" before RLS even
-- runs. Supabase's hosted setup grants these by default for tables created
-- through its tooling; raw `create table` migrations (and the local CLI) do not
-- always, so grant them explicitly. RLS remains the row-level gate.
grant usage on schema public to anon, authenticated;

grant select on
  players, guilds, guild_members, guild_invites, trials,
  daily_gold_runs, trial_runs, media_assets, verification_events
to anon, authenticated;

-- The service role bypasses RLS but still needs table privileges for writes.
grant select, insert, update, delete on
  players, guilds, guild_members, guild_invites, trials,
  daily_gold_runs, trial_runs, media_assets, verification_events
to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 0004_run_media.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- Dragonslayer leaderboard — store the proof media URL on each run.
--
-- Submissions now REQUIRE media proof: a daily-gold run needs a screenshot/image,
-- a trial speedrun needs a video. The media is supplied as an external URL in the
-- submission PR (GitHub-hosted drag-drop / a pasted link) and passed through
-- /api/ingest. We keep that URL on the run row itself.
--
-- Why not media_assets? That table models files UPLOADED THROUGH THE APP to
-- Supabase Storage (its storage_path is a bucket key, and its RLS assumes that).
-- PR media is an external URL, a different source — overloading storage_path with
-- URLs would muddy that contract. So external proof lives here, app uploads stay
-- in media_assets. The run's table implies the kind (gold→image, trial→video).

alter table daily_gold_runs add column if not exists media_url text;
alter table trial_runs     add column if not exists media_url text;

comment on column daily_gold_runs.media_url is
  'External screenshot/image URL proving the haul (from the submission PR). Required at ingest.';
comment on column trial_runs.media_url is
  'External video URL proving the clear (from the submission PR). Required at ingest.';

