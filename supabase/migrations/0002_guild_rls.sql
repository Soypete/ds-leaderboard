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
