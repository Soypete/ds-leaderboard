/**
 * POST /api/ingest — accept a receipt from the GitHub Action (PR path).
 *
 * The Action validates the receipt hash and confirms the PR author matches
 * `receipt.githubHandle`, then POSTs here with the shared secret and the
 * confirmed author. We re-validate the hash (defense in depth), enforce the
 * author match again, and insert pending rows.
 *
 * Body: { receipt: <Receipt>, receiptUrl?: string, author: string }
 * Header: Authorization: Bearer <INGEST_SHARED_SECRET>
 */

import { NextResponse } from 'next/server';

import { serviceClient } from '@/lib/db';
import { ingestReceipt } from '@/lib/ingest';
import { validateReceipt } from '@/lib/receipt';

export const runtime = 'nodejs';

function unauthorized(reason: string) {
  return NextResponse.json({ ok: false, reason }, { status: 401 });
}

export async function POST(req: Request) {
  const secret = process.env.INGEST_SHARED_SECRET;
  if (!secret) return NextResponse.json({ ok: false, reason: 'ingest not configured' }, { status: 503 });

  const auth = req.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${secret}`) return unauthorized('bad or missing ingest secret');

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: 'body is not JSON' }, { status: 400 });
  }

  const { receipt, receiptUrl, author } = (body ?? {}) as {
    receipt?: unknown;
    receiptUrl?: unknown;
    author?: unknown;
  };

  if (typeof author !== 'string' || author === '') {
    return NextResponse.json({ ok: false, reason: 'author missing' }, { status: 400 });
  }

  // Re-validate before trusting the handle, then enforce the author match: the
  // hash proves integrity, the author match proves identity.
  const validation = validateReceipt(receipt);
  if (!validation.ok) {
    return NextResponse.json({ ok: false, reason: validation.reason }, { status: 422 });
  }
  if (validation.receipt.githubHandle.toLowerCase() !== author.toLowerCase()) {
    return NextResponse.json(
      { ok: false, reason: 'receipt handle does not match the submitting author' },
      { status: 403 },
    );
  }

  const db = serviceClient();
  const result = await ingestReceipt(
    db,
    receipt,
    typeof receiptUrl === 'string' ? receiptUrl : null,
  );

  if (!result.ok) {
    return NextResponse.json({ ok: false, reason: result.reason }, { status: result.status });
  }
  return NextResponse.json(
    { ok: true, dailyRunId: result.dailyRunId, trialRunIds: result.trialRunIds },
    { status: 201 },
  );
}
