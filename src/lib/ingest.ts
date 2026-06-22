/**
 * Ingest service — turn a validated receipt into pending board rows.
 *
 * Authorship is decided BEFORE this runs: the caller (the API route) confirms
 * the submitter matches `receipt.githubHandle` (PR author for the Action path,
 * or OAuth session for the web path). Here we trust the handle and only do the
 * structural + hash validation, then upsert the player and insert pending runs.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { validateReceipt, type Receipt } from './receipt';

export type IngestResult =
  | { ok: true; dailyRunId: string | null; trialRunIds: string[] }
  | { ok: false; status: number; reason: string };

/** Find-or-create a player by lowercased handle; returns the player id. */
async function upsertPlayer(db: SupabaseClient, handle: string): Promise<string> {
  const githubHandle = handle.trim().toLowerCase();
  const { data: existing } = await db
    .from('players')
    .select('id')
    .eq('github_handle', githubHandle)
    .maybeSingle();
  if (existing) return existing.id as string;

  const { data, error } = await db
    .from('players')
    .insert({ github_handle: githubHandle })
    .select('id')
    .single();
  if (error) throw new Error(`player upsert failed: ${error.message}`);
  return data.id as string;
}

/**
 * Validate + persist a receipt as pending rows. `receiptUrl` is the gist/PR
 * permalink (or null for web submits). `knownTrialIds`, when provided, gates
 * the trial rows so a renamed/removed trial can't pollute a board.
 */
export async function ingestReceipt(
  db: SupabaseClient,
  payload: unknown,
  receiptUrl: string | null,
  knownTrialIds?: Set<string>,
): Promise<IngestResult> {
  const validation = validateReceipt(payload);
  if (!validation.ok) {
    return { ok: false, status: 422, reason: validation.reason };
  }
  const receipt: Receipt = validation.receipt;

  let playerId: string;
  try {
    playerId = await upsertPlayer(db, receipt.githubHandle);
  } catch (err) {
    return { ok: false, status: 500, reason: (err as Error).message };
  }

  // ── Board 1: the day's gold haul (one canonical row per player/day/realm). ──
  let dailyRunId: string | null = null;
  if (receipt.goldEarnedThatDay > 0) {
    const { data, error } = await db
      .from('daily_gold_runs')
      .upsert(
        {
          player_id: playerId,
          day: receipt.day,
          gold: receipt.goldEarnedThatDay,
          game_version: receipt.gameVersion,
          repo_sigil: receipt.repo.sigil,
          receipt_hash: receipt.contentHash,
          receipt_url: receiptUrl,
          status: 'pending',
        },
        { onConflict: 'player_id,day,repo_sigil' },
      )
      .select('id')
      .single();
    if (error) return { ok: false, status: 500, reason: `gold run insert: ${error.message}` };
    dailyRunId = data.id as string;
  }

  // ── Board 2: standing trial speedruns. ─────────────────────────────────────
  const trialRunIds: string[] = [];
  const eligible = knownTrialIds
    ? receipt.trials.filter((t) => knownTrialIds.has(t.trialId))
    : receipt.trials;

  for (const t of eligible) {
    const { data, error } = await db
      .from('trial_runs')
      .insert({
        player_id: playerId,
        trial_id: t.trialId,
        duration_ms: t.durationMs,
        keystrokes: t.keystrokes,
        par: t.par,
        stars: t.stars,
        completed_at: t.completedAt > 0 ? new Date(t.completedAt).toISOString() : null,
        game_version: receipt.gameVersion,
        receipt_hash: receipt.contentHash,
        receipt_url: receiptUrl,
        status: 'pending',
      })
      .select('id')
      .single();
    // A trial id not yet in the catalog (FK violation) is skipped, not fatal —
    // the run's gold haul still lands. Surface other errors.
    if (error) {
      if (error.code === '23503') continue; // foreign_key_violation
      return { ok: false, status: 500, reason: `trial run insert: ${error.message}` };
    }
    trialRunIds.push(data.id as string);
  }

  return { ok: true, dailyRunId, trialRunIds };
}
