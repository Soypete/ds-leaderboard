/**
 * Storage helpers — presigned uploads to Supabase Storage + the media_assets row.
 *
 * SERVER ONLY: these use `serviceClient()` (service-role key) to mint signed
 * upload URLs and to insert past RLS. Never import this module into a client
 * component — it would leak the service key. The browser only ever sees the
 * short-lived signed URL + token returned from the sign route.
 *
 * The two-step flow (see HOSTING.md):
 *   1. server mints a signed upload URL for one object key
 *   2. browser PUTs the file directly to Storage with that URL + token
 *   3. server records the media_assets row (after the PUT lands)
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { serviceClient, type MediaKind } from './db';

export type RunBoard = 'daily_gold_runs' | 'trial_runs';

/** The storage-key prefix each board files its media under. */
const BOARD_PREFIX: Record<RunBoard, 'gold' | 'trial'> = {
  daily_gold_runs: 'gold',
  trial_runs: 'trial',
};

/** The media kind each board requires (gold → screenshot, trial → video). */
export const BOARD_MEDIA_KIND: Record<RunBoard, MediaKind> = {
  daily_gold_runs: 'screenshot',
  trial_runs: 'video',
};

/**
 * Strip a filename down to a safe Storage key segment: keep the basename only
 * (no path traversal), lowercase, allow [a-z0-9._-], collapse the rest to '-'.
 * Empty/degenerate names fall back to a stable default.
 */
export function sanitizeFilename(filename: string): string {
  // Drop any directory part (both separators) so '../../etc/passwd' can't escape.
  const base = filename.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+/, '') // no leading dot/dash (hidden files / odd keys)
    .replace(/-+/g, '-')
    .replace(/-+$/, '');
  return cleaned || 'upload';
}

/**
 * Build the Storage object key for a run's media: `<prefix>/<runId>/<filename>`.
 * The runId is itself sanitized (it's a uuid, but never trust input shaping).
 */
export function buildStorageKey(board: RunBoard, runId: string, filename: string): string {
  const safeRunId = sanitizeFilename(runId);
  return `${BOARD_PREFIX[board]}/${safeRunId}/${sanitizeFilename(filename)}`;
}

export interface SignedUpload {
  /** The full signed URL the browser can PUT to (raw-fetch path). */
  uploadUrl: string;
  /** The token for the supabase-js `uploadToSignedUrl(path, token, file)` path. */
  token: string;
  /** The object key the asset will live at. */
  path: string;
}

/**
 * Mint a signed upload URL for `path` in `bucket`. Returns the URL, the token,
 * and the path. Uses the service client.
 */
export async function createSignedUploadUrl(bucket: string, path: string): Promise<SignedUpload> {
  const { data, error } = await serviceClient()
    .storage.from(bucket)
    .createSignedUploadUrl(path);
  if (error) throw error;
  if (!data) throw new Error('no signed upload URL returned');
  return { uploadUrl: data.signedUrl, token: data.token, path: data.path };
}

export interface RecordMediaInput {
  kind: MediaKind;
  storagePath: string;
  byteSize?: number | null;
  dailyRunId?: string | null;
  trialRunId?: string | null;
  uploadedBy?: string | null;
}

export type RecordMediaResult = { ok: true } | { ok: false; status: number; reason: string };

/**
 * Insert a media_assets row, enforcing the schema's XOR: exactly one of
 * dailyRunId / trialRunId must be set (the table has the same check, but we
 * fail fast with a clear message instead of a raw constraint violation).
 */
export async function recordMediaAsset(
  db: SupabaseClient,
  input: RecordMediaInput,
): Promise<RecordMediaResult> {
  const hasDaily = input.dailyRunId != null;
  const hasTrial = input.trialRunId != null;
  if (hasDaily === hasTrial) {
    return {
      ok: false,
      status: 400,
      reason: 'exactly one of dailyRunId or trialRunId must be set',
    };
  }

  const { error } = await db.from('media_assets').insert({
    kind: input.kind,
    storage_path: input.storagePath,
    byte_size: input.byteSize ?? null,
    daily_run_id: input.dailyRunId ?? null,
    trial_run_id: input.trialRunId ?? null,
    uploaded_by: input.uploadedBy ?? null,
  });
  if (error) return { ok: false, status: 500, reason: `media insert: ${error.message}` };

  return { ok: true };
}
