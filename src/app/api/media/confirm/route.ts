/**
 * POST /api/media/confirm — record a media_assets row after the upload lands.
 *
 * Step 3 of the two-step upload (see HOSTING.md): once the browser has PUT the
 * file to the signed URL from /api/media/sign, it calls here so the server
 * (service key) inserts the media_assets row. That row is what the moderation
 * gate (lib/moderate.ts) checks before approving a run.
 *
 * MVP auth: the ingest shared secret (Bearer), reused like /api/moderate.
 *
 * Body: { board: 'daily_gold_runs'|'trial_runs', runId, kind, path, byteSize? }
 * Header: Authorization: Bearer <INGEST_SHARED_SECRET>
 */

import { NextResponse } from 'next/server';

import { serviceClient } from '@/lib/db';
import { BOARD_MEDIA_KIND, recordMediaAsset, type RunBoard } from '@/lib/storage';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const secret = process.env.INGEST_SHARED_SECRET;
  if (!secret) return NextResponse.json({ ok: false, reason: 'not configured' }, { status: 503 });
  if ((req.headers.get('authorization') ?? '') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: 'body is not JSON' }, { status: 400 });
  }

  const { board, runId, kind, path, byteSize } = (body ?? {}) as {
    board?: unknown;
    runId?: unknown;
    kind?: unknown;
    path?: unknown;
    byteSize?: unknown;
  };

  if (board !== 'daily_gold_runs' && board !== 'trial_runs') {
    return NextResponse.json({ ok: false, reason: 'bad board' }, { status: 400 });
  }
  if (typeof runId !== 'string' || runId === '') {
    return NextResponse.json({ ok: false, reason: 'bad runId' }, { status: 400 });
  }
  if (typeof path !== 'string' || path === '') {
    return NextResponse.json({ ok: false, reason: 'bad path' }, { status: 400 });
  }

  const expected = BOARD_MEDIA_KIND[board as RunBoard];
  if (kind !== expected) {
    return NextResponse.json(
      { ok: false, reason: `${board} expects a ${expected}` },
      { status: 400 },
    );
  }
  if (byteSize !== undefined && (typeof byteSize !== 'number' || byteSize < 0)) {
    return NextResponse.json({ ok: false, reason: 'bad byteSize' }, { status: 400 });
  }

  // Route the run id to the correct FK column so recordMediaAsset's XOR holds.
  const result = await recordMediaAsset(serviceClient(), {
    kind: expected,
    storagePath: path,
    byteSize: typeof byteSize === 'number' ? byteSize : null,
    dailyRunId: board === 'daily_gold_runs' ? runId : null,
    trialRunId: board === 'trial_runs' ? runId : null,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, reason: result.reason }, { status: result.status });
  }
  return NextResponse.json({ ok: true, path }, { status: 201 });
}
