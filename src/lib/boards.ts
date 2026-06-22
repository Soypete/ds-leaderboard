/**
 * Board queries — the read side. Public reads use the anon client (RLS shows
 * only approved/visible rows); the moderator queue uses the service client to
 * see pending rows.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { VerificationStatus } from './db';

export interface GoldBoardRow {
  runId: string;
  handle: string;
  day: string;
  gold: number;
  gameVersion: string;
  receiptUrl: string | null;
  status: VerificationStatus;
}

/** The raw shape of a board select with the player handle joined in. */
interface RawGoldRow {
  id: string;
  day: string;
  gold: number;
  game_version: string;
  receipt_url: string | null;
  status: VerificationStatus;
  // Supabase types an embedded relation as an array; we select one handle.
  players: { github_handle: string } | { github_handle: string }[] | null;
}

const SELECT = 'id, day, gold, game_version, receipt_url, status, players!inner(github_handle)';

function handleOf(players: RawGoldRow['players']): string {
  if (Array.isArray(players)) return players[0]?.github_handle ?? 'unknown';
  return players?.github_handle ?? 'unknown';
}

function mapRow(r: RawGoldRow): GoldBoardRow {
  return {
    runId: r.id,
    handle: handleOf(r.players),
    day: r.day,
    gold: r.gold,
    gameVersion: r.game_version,
    receiptUrl: r.receipt_url,
    status: r.status,
  };
}

/**
 * The approved global gold-per-day board, highest haul first. Optionally
 * scoped to a single day. RLS keeps this to approved+visible rows.
 */
export async function approvedGoldBoard(
  db: SupabaseClient,
  opts: { day?: string; limit?: number } = {},
): Promise<GoldBoardRow[]> {
  let q = db
    .from('daily_gold_runs')
    .select(SELECT)
    .eq('status', 'approved')
    .order('gold', { ascending: false })
    .limit(opts.limit ?? 100);
  if (opts.day) q = q.eq('day', opts.day);

  const { data, error } = await q.returns<RawGoldRow[]>();
  if (error) throw new Error(`gold board query: ${error.message}`);
  return (data ?? []).map(mapRow);
}

/** The moderator queue: pending gold runs, oldest first. Service client only. */
export async function pendingGoldRuns(db: SupabaseClient, limit = 100): Promise<GoldBoardRow[]> {
  const { data, error } = await db
    .from('daily_gold_runs')
    .select(SELECT)
    .eq('status', 'pending')
    .order('submitted_at', { ascending: true })
    .limit(limit)
    .returns<RawGoldRow[]>();
  if (error) throw new Error(`pending runs query: ${error.message}`);
  return (data ?? []).map(mapRow);
}
