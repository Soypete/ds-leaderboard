/**
 * POST /api/moderate — approve or reject a pending run.
 *
 * MVP auth: a moderator shared secret (Bearer) gates the route until GitHub
 * OAuth + guild roles land. Body identifies the run and the verdict.
 *
 * Body: { board: 'daily_gold_runs'|'trial_runs', runId, action: 'approved'|'rejected', note? }
 * Header: Authorization: Bearer <INGEST_SHARED_SECRET>  (reused as the mod secret for now)
 */

import { NextResponse } from 'next/server';

import { serviceClient } from '@/lib/db';
import { moderateRun, type RunBoard } from '@/lib/moderate';

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

  const { board, runId, action, note } = (body ?? {}) as {
    board?: unknown;
    runId?: unknown;
    action?: unknown;
    note?: unknown;
  };

  if (board !== 'daily_gold_runs' && board !== 'trial_runs') {
    return NextResponse.json({ ok: false, reason: 'bad board' }, { status: 400 });
  }
  if (typeof runId !== 'string' || (action !== 'approved' && action !== 'rejected')) {
    return NextResponse.json({ ok: false, reason: 'bad runId or action' }, { status: 400 });
  }

  const result = await moderateRun(serviceClient(), {
    board: board as RunBoard,
    runId,
    action,
    note: typeof note === 'string' ? note : null,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, reason: result.reason }, { status: result.status });
  }
  return NextResponse.json({ ok: true });
}
