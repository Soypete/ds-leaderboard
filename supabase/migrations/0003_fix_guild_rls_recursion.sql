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
