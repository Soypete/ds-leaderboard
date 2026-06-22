/**
 * POST /api/sync-trials — refresh the trial catalog from the game.
 *
 * The game dumps its catalog with `gme leaderboard trials --json`; a job (or a
 * human) POSTs that JSON here so the per-trial boards know which trials exist.
 * Gated by the same shared secret as ingest, and writes via the service client
 * (the `trials` table has no anon write policy).
 *
 * Body: { gameVersion: string, trials: [{ id, tier, title, par }] }
 * Header: Authorization: Bearer <INGEST_SHARED_SECRET>
 */

import { NextResponse } from 'next/server';

import { serviceClient } from '@/lib/db';
import { syncTrials } from '@/lib/trial-sync';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const secret = process.env.INGEST_SHARED_SECRET;
  if (!secret) return NextResponse.json({ ok: false, reason: 'sync not configured' }, { status: 503 });

  const auth = req.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, reason: 'bad or missing sync secret' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: 'body is not JSON' }, { status: 400 });
  }

  const result = await syncTrials(serviceClient(), body);
  if (!result.ok) {
    return NextResponse.json({ ok: false, reason: result.reason }, { status: result.status });
  }
  return NextResponse.json(
    { ok: true, synced: result.synced, gameVersion: result.gameVersion },
    { status: 200 },
  );
}
