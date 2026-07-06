import { test, expect } from '@playwright/test';

import { serverEnv } from './helpers';

/**
 * The moderator queue and the /api/moderate gate. Moderation auth is the
 * shared secret (MVP) — the queue page itself renders server-side via the
 * service key, and verdicts require the Bearer secret.
 */

test('moderator queue lists pending runs', async ({ page }) => {
  await page.goto('/moderate');
  await expect(page.getByRole('heading', { name: /moderator queue/i })).toBeVisible();
  // Seeded pending runs (novice-knight / sirlintsalot today) or anything the
  // pipeline spec filed — either way the queue table should be present, or the
  // explicit "queue is clear" empty state.
  const table = page.locator('table');
  const empty = page.getByText(/queue is clear/i);
  await expect(table.or(empty).first()).toBeVisible();
});

test('moderate API rejects a bad secret', async ({ request }) => {
  const res = await request.post('/api/moderate', {
    headers: { Authorization: 'Bearer wrong-secret' },
    data: { board: 'daily_gold_runs', runId: '00000000-0000-0000-0000-000000000000', action: 'approved' },
  });
  expect(res.status()).toBe(401);
});

test('dev login mints a session for a seeded handle', async ({ page }) => {
  // Sanity that the local dev-login seam works — the pipeline spec relies on
  // the same stack. Hard-gated server-side to localhost Supabase.
  const res = await page.goto('/api/dev/login?as=captainnobody1');
  expect(res?.ok()).toBe(true);
  await expect(page).toHaveURL('/');
  const cookies = await page.context().cookies();
  expect(cookies.some((c) => /^sb-.*-auth-token$/.test(c.name))).toBe(true);
});

test('moderate API accepts the real secret but a fake run id fails cleanly', async ({ request }) => {
  const secret = serverEnv('INGEST_SHARED_SECRET');
  const res = await request.post('/api/moderate', {
    headers: { Authorization: `Bearer ${secret}` },
    data: { board: 'daily_gold_runs', runId: '00000000-0000-0000-0000-000000000000', action: 'rejected', note: 'e2e probe' },
  });
  // Authenticated (not 401) — the verdict itself fails because the run doesn't exist.
  expect(res.status()).not.toBe(401);
});
