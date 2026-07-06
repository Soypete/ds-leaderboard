import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  canonicalReceipt,
  hashReceipt,
  validateReceipt,
  verifyReceiptHash,
  type Receipt,
} from './receipt';

/** Build a correctly-sealed receipt for tests (mirrors the game's buildReceipt). */
function sealed(overrides: Partial<Omit<Receipt, 'contentHash'>> = {}): Receipt {
  const unsealed: Omit<Receipt, 'contentHash'> = {
    schema: 'dragonslayer-receipt/v1',
    gameVersion: '0.1.0',
    saveVersion: 1,
    githubHandle: 'octocat',
    repo: { sigil: 'a'.repeat(40) },
    day: '2026-06-20',
    goldEarnedThatDay: 55,
    trials: [
      { trialId: 't1-eastward-squire', durationMs: 4200, keystrokes: 3, par: 3, stars: 3, completedAt: 1_700_000_000_000 },
    ],
    generatedAt: 1_700_000_222_000,
    ...overrides,
  };
  return { ...unsealed, contentHash: hashReceipt(unsealed) };
}

describe('verifyReceiptHash', () => {
  it('golden receipt hashes to the pinned digest (cross-repo wire-format lock)', () => {
    // The same fixture + digest are pinned in the game (DragonSlayer
    // src/ui/receipt.test.ts) and ds-submissions
    // (scripts/validate-receipt.test.mjs). If this fails you changed the wire
    // format: bump dragonslayer-receipt/vN and update this mirror plus
    // ds-submissions/scripts/validate-receipt.mjs together with the game's
    // src/ui/receipt.ts. See the game's docs/LEADERBOARD.md for the spec.
    const golden = JSON.parse(
      readFileSync(new URL('./__fixtures__/golden-receipt.json', import.meta.url), 'utf8'),
    ) as Receipt;
    const { contentHash, ...rest } = golden;
    expect(contentHash).toBe('172759319a063fbd7912a5dfeb33258929102650e3d54e7c8a6581ac0e91efa0');
    expect(hashReceipt(rest)).toBe(contentHash);
    expect(verifyReceiptHash(golden)).toBe(true);
  });

  it('passes a correctly-sealed receipt', () => {
    expect(verifyReceiptHash(sealed())).toBe(true);
  });

  it('fails when any sealed field is altered', () => {
    const r = sealed();
    expect(verifyReceiptHash({ ...r, goldEarnedThatDay: 9999 })).toBe(false);
    expect(verifyReceiptHash({ ...r, githubHandle: 'impostor' })).toBe(false);
  });

  it('canonical render is stable regardless of key order', () => {
    const r = sealed();
    const { contentHash, ...rest } = r;
    const reordered = {
      day: rest.day,
      schema: rest.schema,
      trials: rest.trials,
      repo: rest.repo,
      generatedAt: rest.generatedAt,
      githubHandle: rest.githubHandle,
      goldEarnedThatDay: rest.goldEarnedThatDay,
      gameVersion: rest.gameVersion,
      saveVersion: rest.saveVersion,
    };
    expect(canonicalReceipt(reordered)).toBe(canonicalReceipt(rest));
    expect(hashReceipt(reordered)).toBe(contentHash);
  });

  it('omits an absent repo name from the canonical render', () => {
    const withName = canonicalReceipt({ ...sealed(), repo: { sigil: 'a'.repeat(40), name: 'keep' } });
    const without = canonicalReceipt(sealed());
    expect(withName).toContain('"name":"keep"');
    expect(without).not.toContain('"name"');
  });
});

describe('validateReceipt', () => {
  it('accepts a well-formed, correctly-hashed receipt', () => {
    const result = validateReceipt(sealed());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.receipt.githubHandle).toBe('octocat');
  });

  it('rejects a non-object payload', () => {
    expect(validateReceipt(null)).toMatchObject({ ok: false });
    expect(validateReceipt('nope')).toMatchObject({ ok: false });
  });

  it('rejects an unknown schema', () => {
    const bad = { ...sealed(), schema: 'something/v9' } as unknown;
    expect(validateReceipt(bad)).toMatchObject({ ok: false, reason: expect.stringContaining('schema') });
  });

  it('rejects a malformed day', () => {
    const r = sealed({ day: '06/20/2026' } as Partial<Receipt>);
    // re-seal so only the day shape is wrong, not the hash
    expect(validateReceipt(r)).toMatchObject({ ok: false });
  });

  it('rejects negative gold', () => {
    expect(validateReceipt(sealed({ goldEarnedThatDay: -1 }))).toMatchObject({ ok: false });
  });

  it('rejects malformed trials', () => {
    const r = { ...sealed(), trials: [{ trialId: 'x' }] } as unknown;
    expect(validateReceipt(r)).toMatchObject({ ok: false, reason: expect.stringContaining('trials') });
  });

  it('rejects a tampered receipt (good shape, bad hash)', () => {
    const r = sealed();
    const tampered = { ...r, goldEarnedThatDay: 1_000_000 };
    expect(validateReceipt(tampered)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('contentHash'),
    });
  });

  it('accepts an empty trials list', () => {
    expect(validateReceipt(sealed({ trials: [] })).ok).toBe(true);
  });
});
