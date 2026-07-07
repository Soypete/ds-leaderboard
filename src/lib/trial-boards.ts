/**
 * Trial board queries — the read side for the per-trial vim speedruns.
 *
 * Like `boards.ts`, public reads use the anon client (RLS shows only
 * approved/visible rows). Supabase types an embedded relation as a possible
 * array, so we normalize the joined handle with `handleOf()` — same shape the
 * gold board uses; copied here to keep the two boards independent.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { TrialRow, VerificationStatus } from './db';

export interface TrialBoardRow {
  runId: string;
  handle: string;
  durationMs: number;
  keystrokes: number;
  par: number;
  stars: number;
  gameVersion: string;
  receiptUrl: string | null;
  completedAt: string | null;
  status: VerificationStatus;
}

/** The raw shape of a trial-run select with the player handle joined in. */
interface RawTrialRow {
  id: string;
  duration_ms: number;
  keystrokes: number;
  par: number;
  stars: number;
  game_version: string;
  receipt_url: string | null;
  completed_at: string | null;
  status: VerificationStatus;
  // Supabase types an embedded relation as an array; we select one handle.
  players: { github_handle: string } | { github_handle: string }[] | null;
}

const SELECT =
  'id, duration_ms, keystrokes, par, stars, game_version, receipt_url, completed_at, status, players!inner(github_handle)';

function handleOf(players: RawTrialRow['players']): string {
  if (Array.isArray(players)) return players[0]?.github_handle ?? 'unknown';
  return players?.github_handle ?? 'unknown';
}

function mapRow(r: RawTrialRow): TrialBoardRow {
  return {
    runId: r.id,
    handle: handleOf(r.players),
    durationMs: r.duration_ms,
    keystrokes: r.keystrokes,
    par: r.par,
    stars: r.stars,
    gameVersion: r.game_version,
    receiptUrl: r.receipt_url,
    completedAt: r.completed_at,
    status: r.status,
  };
}

/**
 * The approved speedrun board for a single trial. Fastest run first: order by
 * duration, then fewer keystrokes, then more stars, then earliest submission.
 * RLS keeps this to approved + visible rows.
 */
export async function approvedTrialBoard(
  db: SupabaseClient,
  trialId: string,
  opts: { limit?: number } = {},
): Promise<TrialBoardRow[]> {
  const { data, error } = await db
    .from('trial_runs')
    .select(SELECT)
    .eq('trial_id', trialId)
    .eq('status', 'approved')
    .order('duration_ms', { ascending: true })
    .order('keystrokes', { ascending: true })
    .order('stars', { ascending: false })
    .order('submitted_at', { ascending: true })
    .limit(opts.limit ?? 100)
    .returns<RawTrialRow[]>();
  if (error) throw new Error(`trial board query: ${error.message}`);
  return (data ?? []).map(mapRow);
}

/** The trial catalog, lowest tier first then title — the index of boards. */
export async function listTrials(db: SupabaseClient): Promise<TrialRow[]> {
  const { data, error } = await db
    .from('trials')
    .select('id, tier, title, par, game_version')
    .order('tier', { ascending: true })
    .order('title', { ascending: true })
    .returns<TrialRow[]>();
  if (error) throw new Error(`trials catalog query: ${error.message}`);
  return data ?? [];
}

/** A single trial's catalog entry, or null if it isn't in the catalog. */
export async function getTrial(db: SupabaseClient, trialId: string): Promise<TrialRow | null> {
  const { data, error } = await db
    .from('trials')
    .select('id, tier, title, par, game_version')
    .eq('id', trialId)
    .maybeSingle<TrialRow>();
  if (error) throw new Error(`trial lookup query: ${error.message}`);
  return data ?? null;
}
