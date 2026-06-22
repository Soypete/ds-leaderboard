/**
 * POST /api/media/sign — mint a presigned upload URL for a run's media.
 *
 * Step 1 of the two-step upload (see HOSTING.md): the server (service key) hands
 * the browser a short-lived signed URL + token scoped to one object key. The
 * browser PUTs the file there directly, then calls /api/media/confirm to record
 * the media_assets row. This route does NOT touch the database.
 *
 * MVP auth: the ingest shared secret (Bearer), reused as the media secret like
 * /api/moderate does until GitHub OAuth + guild roles land.
 *
 * Body: { board: 'daily_gold_runs'|'trial_runs', runId, kind, filename }
 * Header: Authorization: Bearer <INGEST_SHARED_SECRET>
 */

import { NextResponse } from 'next/server';

import {
  BOARD_MEDIA_KIND,
  buildStorageKey,
  createSignedUploadUrl,
  type RunBoard,
} from '@/lib/storage';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const secret = process.env.INGEST_SHARED_SECRET;
  if (!secret) return NextResponse.json({ ok: false, reason: 'not configured' }, { status: 503 });
  if ((req.headers.get('authorization') ?? '') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  }

  const bucket = process.env.SUPABASE_MEDIA_BUCKET;
  if (!bucket) {
    return NextResponse.json({ ok: false, reason: 'media bucket not configured' }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: 'body is not JSON' }, { status: 400 });
  }

  const { board, runId, kind, filename } = (body ?? {}) as {
    board?: unknown;
    runId?: unknown;
    kind?: unknown;
    filename?: unknown;
  };

  if (board !== 'daily_gold_runs' && board !== 'trial_runs') {
    return NextResponse.json({ ok: false, reason: 'bad board' }, { status: 400 });
  }
  if (typeof runId !== 'string' || runId === '') {
    return NextResponse.json({ ok: false, reason: 'bad runId' }, { status: 400 });
  }
  if (typeof filename !== 'string' || filename === '') {
    return NextResponse.json({ ok: false, reason: 'bad filename' }, { status: 400 });
  }

  // The kind must match the board: gold → screenshot, trial → video.
  const expected = BOARD_MEDIA_KIND[board as RunBoard];
  if (kind !== expected) {
    return NextResponse.json(
      { ok: false, reason: `${board} expects a ${expected}` },
      { status: 400 },
    );
  }

  const path = buildStorageKey(board as RunBoard, runId, filename);

  try {
    const signed = await createSignedUploadUrl(bucket, path);
    return NextResponse.json({
      ok: true,
      uploadUrl: signed.uploadUrl,
      token: signed.token,
      path: signed.path,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, reason: `could not mint upload URL: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
