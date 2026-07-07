import { test, expect } from '@playwright/test';

/**
 * The public boards, rendered against supabase/seed.sql. Anon should see only
 * approved, global-or-public-guild rows.
 */

test('gold board renders the seeded field', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /richest hauls/i })).toBeVisible();
  // Seeded approved runs are visible to anon…
  await expect(page.getByRole('link', { name: 'captainnobody1' }).first()).toBeVisible();
  await expect(page.getByText('sirlintsalot').first()).toBeVisible();
  // …but pending/rejected seed rows never reach the public board. The pending
  // seed runs belong to novice-knight (its only other row is rejected).
  await expect(page.getByText('novice-knight')).toHaveCount(0);
});

test('trial catalog lists the seeded trials by tier', async ({ page }) => {
  await page.goto('/trials');
  await expect(page.getByRole('heading', { name: /one board per trial/i })).toBeVisible();
  await expect(page.getByText('First Steps in the Realm')).toBeVisible();
  await expect(page.getByText('The Paragraph Gauntlet')).toBeVisible();
});

test('a single trial board renders', async ({ page }) => {
  await page.goto('/trials/t3-echo-the-incantation');
  await expect(page.getByText(/Echo the Incantation/i).first()).toBeVisible();
});

test('a public guild board is visible to anon', async ({ page }) => {
  await page.goto('/guilds/roundtable');
  await expect(page.getByText(/Knights of the Round Table/i).first()).toBeVisible();
});
