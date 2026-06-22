import { describe, expect, it } from 'vitest';

import { parseCatalog, toTrialRows, type TrialCatalog } from './trial-sync';

/** A well-formed catalog matching `gme leaderboard trials --json`. */
function catalog(overrides: Partial<TrialCatalog> = {}): unknown {
  return {
    gameVersion: '0.1.0',
    trials: [
      { id: 't1-eastward-squire', tier: 1, title: 'Eastward, Squire', par: 3 },
      { id: 't3-echo-the-incantation', tier: 3, title: 'Echo the Incantation', par: 7 },
    ],
    ...overrides,
  };
}

describe('parseCatalog', () => {
  it('accepts a well-formed catalog', () => {
    const result = parseCatalog(catalog());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.catalog.gameVersion).toBe('0.1.0');
      expect(result.catalog.trials).toHaveLength(2);
      expect(result.catalog.trials[0]).toEqual({
        id: 't1-eastward-squire',
        tier: 1,
        title: 'Eastward, Squire',
        par: 3,
      });
    }
  });

  it('accepts an empty trial list', () => {
    const result = parseCatalog(catalog({ trials: [] }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.catalog.trials).toHaveLength(0);
  });

  it('rejects a non-object payload', () => {
    expect(parseCatalog(null).ok).toBe(false);
    expect(parseCatalog('nope').ok).toBe(false);
    expect(parseCatalog([]).ok).toBe(false);
  });

  it('rejects a missing or empty gameVersion', () => {
    expect(parseCatalog({ trials: [] }).ok).toBe(false);
    expect(parseCatalog({ gameVersion: '', trials: [] }).ok).toBe(false);
    expect(parseCatalog({ gameVersion: 1, trials: [] }).ok).toBe(false);
  });

  it('rejects trials that are not an array', () => {
    expect(parseCatalog({ gameVersion: '0.1.0', trials: {} }).ok).toBe(false);
    expect(parseCatalog({ gameVersion: '0.1.0' }).ok).toBe(false);
  });

  it('rejects an entry with a bad id', () => {
    const result = parseCatalog(catalog({ trials: [{ tier: 1, title: 'x', par: 3 } as never] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/id/);
  });

  it('rejects a non-integer tier', () => {
    const result = parseCatalog(
      catalog({ trials: [{ id: 'a', tier: 1.5, title: 'x', par: 3 } as never] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/tier/);
  });

  it('rejects an empty title', () => {
    const result = parseCatalog(
      catalog({ trials: [{ id: 'a', tier: 1, title: '', par: 3 } as never] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/title/);
  });

  it('rejects a negative or non-integer par', () => {
    expect(
      parseCatalog(catalog({ trials: [{ id: 'a', tier: 1, title: 'x', par: -1 } as never] })).ok,
    ).toBe(false);
    expect(
      parseCatalog(catalog({ trials: [{ id: 'a', tier: 1, title: 'x', par: 2.5 } as never] })).ok,
    ).toBe(false);
  });

  it('rejects duplicate trial ids', () => {
    const result = parseCatalog(
      catalog({
        trials: [
          { id: 'dup', tier: 1, title: 'A', par: 3 },
          { id: 'dup', tier: 2, title: 'B', par: 4 },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/duplicate/);
  });
});

describe('toTrialRows', () => {
  it('maps catalog entries to trial rows, stamping the game version', () => {
    const parsed = parseCatalog(catalog());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const rows = toTrialRows(parsed.catalog);
    expect(rows).toEqual([
      {
        id: 't1-eastward-squire',
        tier: 1,
        title: 'Eastward, Squire',
        par: 3,
        game_version: '0.1.0',
      },
      {
        id: 't3-echo-the-incantation',
        tier: 3,
        title: 'Echo the Incantation',
        par: 7,
        game_version: '0.1.0',
      },
    ]);
  });

  it('maps an empty catalog to no rows', () => {
    expect(toTrialRows({ gameVersion: '0.1.0', trials: [] })).toEqual([]);
  });
});
