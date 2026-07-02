-- Dragonslayer leaderboard — initial schema.
--
-- Apply with the Supabase CLI (`supabase db push`) or paste into the SQL editor.
-- RLS is ON for every table: the browser (anon key) sees only approved rows and
-- public guilds; all writes go through the service-role key in server routes.

-- Use a dedicated schema for this project
create schema if not exists ds_leaderboard;
alter database set search_path to ds_leaderboard, public;

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
