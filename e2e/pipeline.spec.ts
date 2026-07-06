import { test, expect } from '@playwright/test';

import { hashReceipt, RECEIPT_SCHEMA, type Receipt } from '../src/lib/receipt';
import { serverEnv } from './helpers';

/**
 * The full submit pipe: seal a receipt → /api/ingest files it pending →
 * /api/moderate approves it → it appears on the public gold board.
 *
 * The receipt is built in-test with the real hashReceipt so it can never go
 * stale against the wire format. A unique handle per run keeps the suite
 * re-runnable without `npm run dev:reset`.
 */

function sealReceipt(handle: string, day: string, gold: number): Receipt {
  const unsealed = {
    schema: RECEIPT_SCHEMA,
    gameVersion: '0.1.0',
    saveVersion: 1,
    githubHandle: handle,
    repo: { sigil: 'e2e-sigil-0000000000000000000000000000000000000000', name: 'e2e-realm' },
    day,
    goldEarnedThatDay: gold,
    trials: [],
    generatedAt: 1782500000000,
  };
  return { ...unsealed, contentHash: hashReceipt(unsealed) };
}

test('receipt travels ingest → moderation → public board', async ({ page, request }) => {
  const secret = serverEnv('INGEST_SHARED_SECRET');
  // Unique per run (worker index + time-of-day derived from the test info is
  // overkill; a random suffix is fine here — this is a live local stack).
  const handle = `e2e-knight-${Math.random().toString(36).slice(2, 8)}`;
  const receipt = sealReceipt(handle, '2026-07-01', 123);

  // 1. Ingest — must land as pending (201).
  const ingest = await request.post('/api/ingest', {
    headers: { Authorization: `Bearer ${secret}` },
    data: { receipt, author: handle, receiptUrl: 'https://example.com/e2e' },
  });
  expect(ingest.status(), await ingest.text()).toBe(201);
  const body = (await ingest.json()) as { ok: boolean; dailyRunId: string | null };
  expect(body.ok).toBe(true);
  expect(body.dailyRunId).toBeTruthy();

  // 2. Pending runs stay off the public board.
  await page.goto('/');
  await expect(page.getByText(handle)).toHaveCount(0);

  // 3. The moderator queue shows it.
  await page.goto('/moderate');
  await expect(page.getByText(handle).first()).toBeVisible();

  // 4. Approval requires proof — file the screenshot record first (same
  //    shared-secret contract the upload flow's confirm step uses), then
  //    approve via the API (the UI path prompts for the secret via
  //    window.prompt, which is awkward to drive; the route is the contract).
  const noProof = await request.post('/api/moderate', {
    headers: { Authorization: `Bearer ${secret}` },
    data: { board: 'daily_gold_runs', runId: body.dailyRunId, action: 'approved' },
  });
  expect(noProof.status(), 'approval without a screenshot must be refused').toBe(409);

  const media = await request.post('/api/media/confirm', {
    headers: { Authorization: `Bearer ${secret}` },
    data: {
      board: 'daily_gold_runs',
      runId: body.dailyRunId,
      kind: 'screenshot',
      path: `e2e/${handle}.png`,
      byteSize: 1024,
    },
  });
  expect(media.status(), await media.text()).toBe(201);

  const verdict = await request.post('/api/moderate', {
    headers: { Authorization: `Bearer ${secret}` },
    data: { board: 'daily_gold_runs', runId: body.dailyRunId, action: 'approved' },
  });
  expect(verdict.status(), await verdict.text()).toBe(200);

  // 5. The approved run rides onto the public gold board (dev mode renders
  //    fresh — no ISR wait).
  await page.goto('/');
  await expect(page.getByText(handle).first()).toBeVisible();
});

test('ingest rejects a tampered receipt and an impostor author', async ({ request }) => {
  const secret = serverEnv('INGEST_SHARED_SECRET');
  const receipt = sealReceipt('e2e-tamper', '2026-07-01', 50);

  const tampered = { ...receipt, goldEarnedThatDay: 99999 };
  const res1 = await request.post('/api/ingest', {
    headers: { Authorization: `Bearer ${secret}` },
    data: { receipt: tampered, author: 'e2e-tamper' },
  });
  expect(res1.status()).toBe(422);

  const res2 = await request.post('/api/ingest', {
    headers: { Authorization: `Bearer ${secret}` },
    data: { receipt, author: 'someone-else' },
  });
  expect(res2.status()).toBe(403);

  const res3 = await request.post('/api/ingest', {
    headers: { Authorization: 'Bearer wrong' },
    data: { receipt, author: 'e2e-tamper' },
  });
  expect(res3.status()).toBe(401);
});
