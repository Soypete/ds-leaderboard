/**
 * Guild queries — the read + write side for private team boards.
 *
 * Reads that a member is allowed to see use the anon client (RLS does the
 * visibility filtering: public-guild rows for everyone, private-guild rows for
 * authenticated members — see migration 0002). Writes (create guild, mint an
 * invite, accept an invite) use the service client and SERVER ONLY paths — it
 * bypasses RLS, so never import this module's write helpers into client code.
 *
 * Board shapes are copied from boards.ts / trial-boards.ts (the same
 * `handleOf()` normalization for the embedded player relation) and re-scoped to
 * a single guild_id. Kept independent rather than editing the global board files.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { GuildInviteRow, GuildRole, GuildRow, TrialRow, VerificationStatus } from './db';

// Re-export so existing importers of these from guilds.ts keep working.
export type { GuildRow, GuildInviteRow, GuildRole } from './db';

// ── Row shapes ────────────────────────────────────────────────────────────────

/** A guild member joined with its player handle — the shape the roster renders. */
export interface GuildMemberRow {
  playerId: string;
  handle: string;
  role: GuildRole;
  joinedAt: string;
}

// ── Slug / token helpers (pure — unit-tested) ────────────────────────────────

/**
 * Sanitize a free-text guild name into a URL slug: lowercase, [a-z0-9-], collapse
 * runs of unsafe characters to a single dash, trim leading/trailing dashes.
 * Returns '' for a degenerate input so callers can reject it (slugs must be
 * non-empty — unlike a filename, there's no sensible default).
 */
export function sanitizeSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

export const SLUG_MAX = 48;

/** A slug is valid when it's non-empty, within length, and already canonical. */
export function isValidSlug(slug: string): boolean {
  if (slug.length === 0 || slug.length > SLUG_MAX) return false;
  return sanitizeSlug(slug) === slug;
}

/**
 * Mint a URL-safe, unguessable invite token. Uses Web Crypto (available in both
 * the Node and edge runtimes Next uses) — 32 bytes → 64 hex chars.
 */
export function generateInviteToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/** Whether an invite token is well-formed (64 lowercase hex chars). */
export function isValidInviteToken(token: string): boolean {
  return /^[0-9a-f]{64}$/.test(token);
}

// ── Reads (anon client, RLS-gated) ───────────────────────────────────────────

const GUILD_SELECT = 'id, slug, name, is_private, owner_id, created_at';

/** A single guild by slug, or null. RLS gates private guilds to members. */
export async function getGuildBySlug(
  db: SupabaseClient,
  slug: string,
): Promise<GuildRow | null> {
  const { data, error } = await db
    .from('guilds')
    .select(GUILD_SELECT)
    .eq('slug', slug)
    .maybeSingle<GuildRow>();
  if (error) throw new Error(`guild lookup query: ${error.message}`);
  return data ?? null;
}

/** Public guilds, newest first — the open-recruitment list anyone can browse. */
export async function listPublicGuilds(
  db: SupabaseClient,
  opts: { limit?: number } = {},
): Promise<GuildRow[]> {
  const { data, error } = await db
    .from('guilds')
    .select(GUILD_SELECT)
    .eq('is_private', false)
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 100)
    .returns<GuildRow[]>();
  if (error) throw new Error(`public guilds query: ${error.message}`);
  return data ?? [];
}

/** Raw guild_members select with the joined player handle. */
interface RawMemberRow {
  player_id: string;
  role: GuildRole;
  joined_at: string;
  players: { github_handle: string } | { github_handle: string }[] | null;
}

function handleOf(players: RawMemberRow['players']): string {
  if (Array.isArray(players)) return players[0]?.github_handle ?? 'unknown';
  return players?.github_handle ?? 'unknown';
}

/**
 * The guild roster: members joined with their handle, owners/mods first then by
 * join time. RLS keeps this to guilds the caller may see.
 */
export async function listGuildMembers(
  db: SupabaseClient,
  guildId: string,
): Promise<GuildMemberRow[]> {
  const { data, error } = await db
    .from('guild_members')
    .select('player_id, role, joined_at, players!inner(github_handle)')
    .eq('guild_id', guildId)
    .order('joined_at', { ascending: true })
    .returns<RawMemberRow[]>();
  if (error) throw new Error(`guild members query: ${error.message}`);
  const rank: Record<GuildRole, number> = { owner: 0, mod: 1, member: 2 };
  return (data ?? [])
    .map((r) => ({
      playerId: r.player_id,
      handle: handleOf(r.players),
      role: r.role,
      joinedAt: r.joined_at,
    }))
    .sort((a, b) => rank[a.role] - rank[b.role] || a.joinedAt.localeCompare(b.joinedAt));
}

// ── Guild-scoped boards (copied shape from boards.ts / trial-boards.ts) ───────

export interface GuildGoldRow {
  runId: string;
  handle: string;
  day: string;
  gold: number;
  gameVersion: string;
  receiptUrl: string | null;
  status: VerificationStatus;
}

interface RawGuildGoldRow {
  id: string;
  day: string;
  gold: number;
  game_version: string;
  receipt_url: string | null;
  status: VerificationStatus;
  players: { github_handle: string } | { github_handle: string }[] | null;
}

const GOLD_SELECT =
  'id, day, gold, game_version, receipt_url, status, players!inner(github_handle)';

function goldHandleOf(players: RawGuildGoldRow['players']): string {
  if (Array.isArray(players)) return players[0]?.github_handle ?? 'unknown';
  return players?.github_handle ?? 'unknown';
}

/**
 * A guild's gold-per-day board: approved runs scoped to this guild_id, highest
 * haul first. RLS gates private-guild rows to members.
 */
export async function guildGoldBoard(
  db: SupabaseClient,
  guildId: string,
  opts: { limit?: number } = {},
): Promise<GuildGoldRow[]> {
  const { data, error } = await db
    .from('daily_gold_runs')
    .select(GOLD_SELECT)
    .eq('guild_id', guildId)
    .eq('status', 'approved')
    .order('gold', { ascending: false })
    .limit(opts.limit ?? 100)
    .returns<RawGuildGoldRow[]>();
  if (error) throw new Error(`guild gold board query: ${error.message}`);
  return (data ?? []).map((r) => ({
    runId: r.id,
    handle: goldHandleOf(r.players),
    day: r.day,
    gold: r.gold,
    gameVersion: r.game_version,
    receiptUrl: r.receipt_url,
    status: r.status,
  }));
}

export interface GuildTrialRow {
  runId: string;
  handle: string;
  trialId: string;
  durationMs: number;
  keystrokes: number;
  par: number;
  stars: number;
  receiptUrl: string | null;
  status: VerificationStatus;
}

interface RawGuildTrialRow {
  id: string;
  trial_id: string;
  duration_ms: number;
  keystrokes: number;
  par: number;
  stars: number;
  receipt_url: string | null;
  status: VerificationStatus;
  players: { github_handle: string } | { github_handle: string }[] | null;
}

const TRIAL_SELECT =
  'id, trial_id, duration_ms, keystrokes, par, stars, receipt_url, status, players!inner(github_handle)';

function trialHandleOf(players: RawGuildTrialRow['players']): string {
  if (Array.isArray(players)) return players[0]?.github_handle ?? 'unknown';
  return players?.github_handle ?? 'unknown';
}

/**
 * A guild's trial-speedrun board: approved trial runs scoped to this guild_id,
 * fastest first (duration, then keystrokes, then more stars). RLS gates private
 * rows to members.
 */
export async function guildTrialBoard(
  db: SupabaseClient,
  guildId: string,
  opts: { limit?: number } = {},
): Promise<GuildTrialRow[]> {
  const { data, error } = await db
    .from('trial_runs')
    .select(TRIAL_SELECT)
    .eq('guild_id', guildId)
    .eq('status', 'approved')
    .order('duration_ms', { ascending: true })
    .order('keystrokes', { ascending: true })
    .order('stars', { ascending: false })
    .limit(opts.limit ?? 100)
    .returns<RawGuildTrialRow[]>();
  if (error) throw new Error(`guild trial board query: ${error.message}`);
  return (data ?? []).map((r) => ({
    runId: r.id,
    handle: trialHandleOf(r.players),
    trialId: r.trial_id,
    durationMs: r.duration_ms,
    keystrokes: r.keystrokes,
    par: r.par,
    stars: r.stars,
    receiptUrl: r.receipt_url,
    status: r.status,
  }));
}

// re-export so a board page can render a trial title without importing two modules
export type { TrialRow };

// ── Writes (service client, SERVER ONLY) ─────────────────────────────────────

export type GuildWriteResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; reason: string };

/**
 * Most guilds one player may OWN at once — an anti-spam cap (cf. Advent of Code's
 * private-leaderboard limit). Membership in other people's guilds is unbounded;
 * only owned guilds count. Bump this single constant to loosen the cap.
 */
export const OWNED_GUILD_CAP = 5;

/** How many guilds `ownerId` currently owns. Used to enforce OWNED_GUILD_CAP. */
export async function countGuildsOwnedBy(
  db: SupabaseClient,
  ownerId: string,
): Promise<number> {
  const { count, error } = await db
    .from('guilds')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', ownerId);
  if (error) throw new Error(`count owned guilds: ${error.message}`);
  return count ?? 0;
}

export interface CreateGuildInput {
  name: string;
  slug?: string; // defaults to a slug derived from the name
  isPrivate?: boolean;
  ownerId: string; // players.id of the creator
}

/**
 * Create a guild owned by `ownerId` and seed the owner's membership row.
 * Validates the slug (derived from the name when omitted) and enforces
 * OWNED_GUILD_CAP. Uses the service client (bypasses RLS); call only from a
 * server route that has already authenticated the owner.
 */
export async function createGuild(
  db: SupabaseClient,
  input: CreateGuildInput,
): Promise<GuildWriteResult<GuildRow>> {
  const name = input.name.trim();
  if (name.length === 0) return { ok: false, status: 400, reason: 'guild name is required' };

  const slug = sanitizeSlug(input.slug && input.slug.length > 0 ? input.slug : name);
  if (!isValidSlug(slug)) {
    return { ok: false, status: 400, reason: 'guild name yields no valid slug' };
  }

  const owned = await countGuildsOwnedBy(db, input.ownerId);
  if (owned >= OWNED_GUILD_CAP) {
    return {
      ok: false,
      status: 429,
      reason: `you already own ${owned} guilds (limit ${OWNED_GUILD_CAP}) — transfer or disband one first`,
    };
  }

  const { data, error } = await db
    .from('guilds')
    .insert({
      slug,
      name,
      is_private: input.isPrivate ?? true,
      owner_id: input.ownerId,
    })
    .select(GUILD_SELECT)
    .single<GuildRow>();
  if (error) {
    // 23505 = unique_violation (slug already taken).
    const taken = (error as { code?: string }).code === '23505';
    return {
      ok: false,
      status: taken ? 409 : 500,
      reason: taken ? `the slug "${slug}" is already claimed` : `create guild: ${error.message}`,
    };
  }
  if (!data) return { ok: false, status: 500, reason: 'create guild: no row returned' };

  const { error: memberErr } = await db.from('guild_members').insert({
    guild_id: data.id,
    player_id: input.ownerId,
    role: 'owner',
  });
  if (memberErr) {
    return { ok: false, status: 500, reason: `seed owner membership: ${memberErr.message}` };
  }

  return { ok: true, value: data };
}

export interface CreateInviteInput {
  guildId: string;
  email?: string | null;
  /** Optional expiry as an ISO timestamp; null/undefined → no expiry. */
  expiresAt?: string | null;
}

/**
 * Mint an invite token for a guild. Returns the invite row (with its token).
 * Service client only — the calling route must check the actor is an owner/mod.
 */
export async function createInvite(
  db: SupabaseClient,
  input: CreateInviteInput,
): Promise<GuildWriteResult<GuildInviteRow>> {
  const token = generateInviteToken();
  const { data, error } = await db
    .from('guild_invites')
    .insert({
      guild_id: input.guildId,
      token,
      email: input.email ?? null,
      expires_at: input.expiresAt ?? null,
    })
    .select('id, guild_id, token, email, expires_at, used_by')
    .single<GuildInviteRow>();
  if (error) return { ok: false, status: 500, reason: `create invite: ${error.message}` };
  if (!data) return { ok: false, status: 500, reason: 'create invite: no row returned' };
  return { ok: true, value: data };
}

/**
 * Accept an invite: look the token up, check it's unexpired and unused, then add
 * the player as a member and mark the invite used. Idempotent-ish: if the player
 * is already a member we treat it as success (returns the guild). Service client
 * only — the route authenticates the accepting player first.
 */
export async function acceptInvite(
  db: SupabaseClient,
  token: string,
  playerId: string,
): Promise<GuildWriteResult<GuildRow>> {
  if (!isValidInviteToken(token)) {
    return { ok: false, status: 400, reason: 'malformed invite token' };
  }

  const { data: invite, error: lookupErr } = await db
    .from('guild_invites')
    .select('id, guild_id, token, email, expires_at, used_by')
    .eq('token', token)
    .maybeSingle<GuildInviteRow>();
  if (lookupErr) return { ok: false, status: 500, reason: `invite lookup: ${lookupErr.message}` };
  if (!invite) return { ok: false, status: 404, reason: 'no such invite' };

  if (invite.used_by && invite.used_by !== playerId) {
    return { ok: false, status: 409, reason: 'this invite has already been used' };
  }
  if (invite.expires_at && Date.parse(invite.expires_at) < Date.now()) {
    return { ok: false, status: 410, reason: 'this invite has expired' };
  }

  // upsert keeps accept idempotent if the player retries / is already in.
  const { error: memberErr } = await db
    .from('guild_members')
    .upsert(
      { guild_id: invite.guild_id, player_id: playerId, role: 'member' },
      { onConflict: 'guild_id,player_id', ignoreDuplicates: true },
    );
  if (memberErr) return { ok: false, status: 500, reason: `join guild: ${memberErr.message}` };

  const { error: markErr } = await db
    .from('guild_invites')
    .update({ used_by: playerId })
    .eq('id', invite.id);
  if (markErr) return { ok: false, status: 500, reason: `mark invite used: ${markErr.message}` };

  const { data: guild, error: guildErr } = await db
    .from('guilds')
    .select(GUILD_SELECT)
    .eq('id', invite.guild_id)
    .single<GuildRow>();
  if (guildErr) return { ok: false, status: 500, reason: `load joined guild: ${guildErr.message}` };
  if (!guild) return { ok: false, status: 404, reason: 'joined guild not found' };

  return { ok: true, value: guild };
}

/**
 * Guilds the given player belongs to (any role), newest first. Service client
 * recommended (so it works regardless of the auth-cookie read path), but RLS
 * also permits a member to see their own guilds.
 */
export async function listPlayerGuilds(
  db: SupabaseClient,
  playerId: string,
): Promise<GuildRow[]> {
  const { data, error } = await db
    .from('guild_members')
    .select('guilds!inner(id, slug, name, is_private, owner_id, created_at)')
    .eq('player_id', playerId)
    .returns<{ guilds: GuildRow | GuildRow[] }[]>();
  if (error) throw new Error(`player guilds query: ${error.message}`);
  const out: GuildRow[] = [];
  for (const row of data ?? []) {
    const g = Array.isArray(row.guilds) ? row.guilds[0] : row.guilds;
    if (g) out.push(g);
  }
  return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

// ── Membership management (owner/mod powers, SERVER ONLY) ────────────────────

/** Read one member's role, or null when they're not in the guild. */
async function memberRole(
  db: SupabaseClient,
  guildId: string,
  playerId: string,
): Promise<GuildRole | null> {
  const { data, error } = await db
    .from('guild_members')
    .select('role')
    .eq('guild_id', guildId)
    .eq('player_id', playerId)
    .maybeSingle<{ role: GuildRole }>();
  if (error) throw new Error(`member role lookup: ${error.message}`);
  return data?.role ?? null;
}

export interface RemoveMemberInput {
  guildId: string;
  actorId: string; // who is doing the removing
  targetPlayerId: string; // who is being removed
}

/**
 * Remove a member from a guild. The actor must be an owner or mod. Guards:
 *   - the owner can never be removed (transfer or disband instead),
 *   - mods may remove plain members only — not other mods or the owner,
 *   - removing yourself is rejected here (use leaveGuild).
 * Service client only — the route authenticates the actor first.
 */
export async function removeMember(
  db: SupabaseClient,
  input: RemoveMemberInput,
): Promise<GuildWriteResult<{ removed: string }>> {
  const { guildId, actorId, targetPlayerId } = input;
  if (actorId === targetPlayerId) {
    return { ok: false, status: 400, reason: 'use leave to remove yourself' };
  }

  const [actorRole, targetRole] = await Promise.all([
    memberRole(db, guildId, actorId),
    memberRole(db, guildId, targetPlayerId),
  ]);

  if (actorRole !== 'owner' && actorRole !== 'mod') {
    return { ok: false, status: 403, reason: 'only an owner or mod can remove members' };
  }
  if (!targetRole) {
    return { ok: false, status: 404, reason: 'that player is not in this guild' };
  }
  if (targetRole === 'owner') {
    return { ok: false, status: 403, reason: 'the owner cannot be removed — transfer or disband first' };
  }
  if (actorRole === 'mod' && targetRole === 'mod') {
    return { ok: false, status: 403, reason: 'a mod cannot remove another mod' };
  }

  const { error } = await db
    .from('guild_members')
    .delete()
    .eq('guild_id', guildId)
    .eq('player_id', targetPlayerId);
  if (error) return { ok: false, status: 500, reason: `remove member: ${error.message}` };
  return { ok: true, value: { removed: targetPlayerId } };
}

/**
 * The member who should inherit ownership when the current owner leaves: the
 * oldest mod, else the oldest non-owner member. Returns null when the owner is
 * the only member left. Pure-ish (one query); ordering by joined_at is stable.
 */
async function heirApparent(
  db: SupabaseClient,
  guildId: string,
  ownerId: string,
): Promise<{ playerId: string; role: GuildRole } | null> {
  const { data, error } = await db
    .from('guild_members')
    .select('player_id, role, joined_at')
    .eq('guild_id', guildId)
    .neq('player_id', ownerId)
    .order('joined_at', { ascending: true })
    .returns<{ player_id: string; role: GuildRole; joined_at: string }[]>();
  if (error) throw new Error(`heir lookup: ${error.message}`);
  const rows = data ?? [];
  const mod = rows.find((r) => r.role === 'mod');
  const chosen = mod ?? rows[0];
  return chosen ? { playerId: chosen.player_id, role: chosen.role } : null;
}

export interface LeaveGuildInput {
  guildId: string;
  playerId: string;
}

/**
 * Leave a guild. A plain member or mod just drops their row. When the OWNER
 * leaves, ownership auto-passes to the heir apparent (oldest mod, else oldest
 * member) before they go; if they're the last member, the guild is disbanded
 * (deleted, which cascades its rows). Service client only.
 */
export async function leaveGuild(
  db: SupabaseClient,
  input: LeaveGuildInput,
): Promise<GuildWriteResult<{ left: string; newOwnerId: string | null; disbanded: boolean }>> {
  const { guildId, playerId } = input;
  const role = await memberRole(db, guildId, playerId);
  if (!role) return { ok: false, status: 404, reason: 'you are not in this guild' };

  if (role === 'owner') {
    const heir = await heirApparent(db, guildId, playerId);

    if (!heir) {
      // Last one out disbands the guild (cascade removes members/invites/runs).
      const { error } = await db.from('guilds').delete().eq('id', guildId);
      if (error) return { ok: false, status: 500, reason: `disband guild: ${error.message}` };
      return { ok: true, value: { left: playerId, newOwnerId: null, disbanded: true } };
    }

    // Hand the crown to the heir, then drop the departing owner's row.
    const { error: ownerErr } = await db
      .from('guilds')
      .update({ owner_id: heir.playerId })
      .eq('id', guildId);
    if (ownerErr) return { ok: false, status: 500, reason: `pass ownership: ${ownerErr.message}` };

    if (heir.role !== 'owner') {
      const { error: roleErr } = await db
        .from('guild_members')
        .update({ role: 'owner' })
        .eq('guild_id', guildId)
        .eq('player_id', heir.playerId);
      if (roleErr) return { ok: false, status: 500, reason: `promote heir: ${roleErr.message}` };
    }

    const { error: delErr } = await db
      .from('guild_members')
      .delete()
      .eq('guild_id', guildId)
      .eq('player_id', playerId);
    if (delErr) return { ok: false, status: 500, reason: `leave guild: ${delErr.message}` };
    return { ok: true, value: { left: playerId, newOwnerId: heir.playerId, disbanded: false } };
  }

  const { error } = await db
    .from('guild_members')
    .delete()
    .eq('guild_id', guildId)
    .eq('player_id', playerId);
  if (error) return { ok: false, status: 500, reason: `leave guild: ${error.message}` };
  return { ok: true, value: { left: playerId, newOwnerId: null, disbanded: false } };
}

export interface SetMemberRoleInput {
  guildId: string;
  actorId: string;
  targetPlayerId: string;
  role: 'mod' | 'member'; // promote/demote between these; ownership uses transfer
}

/**
 * Promote a member to mod or demote a mod to member. Owner-only. The owner's own
 * row can't be changed here (use transferOwnership). Service client only.
 */
export async function setMemberRole(
  db: SupabaseClient,
  input: SetMemberRoleInput,
): Promise<GuildWriteResult<{ playerId: string; role: GuildRole }>> {
  const { guildId, actorId, targetPlayerId, role } = input;

  const actorRole = await memberRole(db, guildId, actorId);
  if (actorRole !== 'owner') {
    return { ok: false, status: 403, reason: 'only the owner can change roles' };
  }
  if (targetPlayerId === actorId) {
    return { ok: false, status: 400, reason: 'transfer ownership instead of re-roling yourself' };
  }

  const targetRole = await memberRole(db, guildId, targetPlayerId);
  if (!targetRole) return { ok: false, status: 404, reason: 'that player is not in this guild' };
  if (targetRole === 'owner') {
    return { ok: false, status: 400, reason: 'cannot re-role the owner' };
  }

  const { error } = await db
    .from('guild_members')
    .update({ role })
    .eq('guild_id', guildId)
    .eq('player_id', targetPlayerId);
  if (error) return { ok: false, status: 500, reason: `set role: ${error.message}` };
  return { ok: true, value: { playerId: targetPlayerId, role } };
}

export interface TransferOwnershipInput {
  guildId: string;
  actorId: string; // must be the current owner
  newOwnerId: string; // must already be a member
}

/**
 * Hand a guild to another member. Owner-only; the new owner must already belong
 * to the guild. Flips guilds.owner_id, makes the new owner's row 'owner', and
 * demotes the old owner to 'mod' (they stay in the guild). No SQL transaction is
 * available over the JS client, so steps are ordered owner_id → new role → old
 * role and any failure returns a 500 with the guild possibly mid-flip; callers
 * should treat a 500 as "retry the transfer". Service client only.
 */
export async function transferOwnership(
  db: SupabaseClient,
  input: TransferOwnershipInput,
): Promise<GuildWriteResult<{ ownerId: string }>> {
  const { guildId, actorId, newOwnerId } = input;
  if (actorId === newOwnerId) {
    return { ok: false, status: 400, reason: 'you already own this guild' };
  }

  const [actorRole, newRole] = await Promise.all([
    memberRole(db, guildId, actorId),
    memberRole(db, guildId, newOwnerId),
  ]);
  if (actorRole !== 'owner') {
    return { ok: false, status: 403, reason: 'only the owner can transfer ownership' };
  }
  if (!newRole) {
    return { ok: false, status: 404, reason: 'the new owner must already be a guild member' };
  }

  const { error: ownerErr } = await db
    .from('guilds')
    .update({ owner_id: newOwnerId })
    .eq('id', guildId);
  if (ownerErr) return { ok: false, status: 500, reason: `transfer ownership: ${ownerErr.message}` };

  const { error: newRoleErr } = await db
    .from('guild_members')
    .update({ role: 'owner' })
    .eq('guild_id', guildId)
    .eq('player_id', newOwnerId);
  if (newRoleErr) return { ok: false, status: 500, reason: `crown new owner: ${newRoleErr.message}` };

  const { error: oldRoleErr } = await db
    .from('guild_members')
    .update({ role: 'mod' })
    .eq('guild_id', guildId)
    .eq('player_id', actorId);
  if (oldRoleErr) return { ok: false, status: 500, reason: `demote old owner: ${oldRoleErr.message}` };

  return { ok: true, value: { ownerId: newOwnerId } };
}
