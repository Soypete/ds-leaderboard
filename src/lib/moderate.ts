/**
 * Moderation — flip a pending run to approved/rejected and record the act.
 * Service client only (RLS does not see pending rows). Approval of a gold run
 * requires a screenshot asset; trial runs require a video. Rejections may carry
 * a note (required for rejects so the player learns why).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type RunBoard = 'daily_gold_runs' | 'trial_runs';

export interface ModerateInput {
  board: RunBoard;
  runId: string;
  action: 'approved' | 'rejected';
  moderatorId?: string | null;
  note?: string | null;
}

export type ModerateResult = { ok: true } | { ok: false; status: number; reason: string };

const REQUIRED_MEDIA: Record<RunBoard, 'screenshot' | 'video'> = {
  daily_gold_runs: 'screenshot',
  trial_runs: 'video',
};

const RUN_FK: Record<RunBoard, 'daily_run_id' | 'trial_run_id'> = {
  daily_gold_runs: 'daily_run_id',
  trial_runs: 'trial_run_id',
};

export async function moderateRun(
  db: SupabaseClient,
  input: ModerateInput,
): Promise<ModerateResult> {
  if (input.action === 'rejected' && !input.note?.trim()) {
    return { ok: false, status: 400, reason: 'a rejection needs a note' };
  }

  // Approval gate: the matching media must exist.
  if (input.action === 'approved') {
    const { count, error } = await db
      .from('media_assets')
      .select('id', { count: 'exact', head: true })
      .eq(RUN_FK[input.board], input.runId)
      .eq('kind', REQUIRED_MEDIA[input.board]);
    if (error) return { ok: false, status: 500, reason: `media check: ${error.message}` };
    if (!count || count < 1) {
      return {
        ok: false,
        status: 409,
        reason: `cannot approve without a ${REQUIRED_MEDIA[input.board]}`,
      };
    }
  }

  const { error: updateErr } = await db
    .from(input.board)
    .update({ status: input.action })
    .eq('id', input.runId);
  if (updateErr) return { ok: false, status: 500, reason: `status update: ${updateErr.message}` };

  const { error: eventErr } = await db.from('verification_events').insert({
    [RUN_FK[input.board]]: input.runId,
    moderator_id: input.moderatorId ?? null,
    action: input.action,
    note: input.note ?? null,
  });
  if (eventErr) return { ok: false, status: 500, reason: `audit insert: ${eventErr.message}` };

  return { ok: true };
}
