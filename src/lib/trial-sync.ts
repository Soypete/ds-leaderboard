/**
 * Trial-catalog sync — keep the `trials` table in step with the game.
 *
 * The game dumps its catalog with `gme leaderboard trials --json`, shaped:
 *   { gameVersion: string, trials: [{ id, tier, title, par }, ...] }
 *
 * This module parses/validates that JSON (pure, no DB) and upserts it into the
 * `trials` table. The row-mapping is split out (`toTrialRows`) so the mapping
 * can be tested without a database; only `syncTrials` touches Supabase.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { TrialRow } from './db';

export interface CatalogEntry {
  id: string;
  tier: number;
  title: string;
  par: number;
}

export interface TrialCatalog {
  gameVersion: string;
  trials: CatalogEntry[];
}

export type ParseResult =
  | { ok: true; catalog: TrialCatalog }
  | { ok: false; reason: string };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseEntry(raw: unknown, index: number): CatalogEntry | string {
  if (!isObject(raw)) return `trials[${index}] is not an object`;
  const { id, tier, title, par } = raw;
  if (typeof id !== 'string' || id === '') return `trials[${index}].id must be a non-empty string`;
  if (typeof tier !== 'number' || !Number.isInteger(tier)) {
    return `trials[${index}].tier must be an integer`;
  }
  if (typeof title !== 'string' || title === '') {
    return `trials[${index}].title must be a non-empty string`;
  }
  if (typeof par !== 'number' || !Number.isInteger(par) || par < 0) {
    return `trials[${index}].par must be a non-negative integer`;
  }
  return { id, tier, title, par };
}

/**
 * Validate the catalog JSON shape. Returns a typed catalog or a reason string.
 * Pure — no DB, no IO; safe to unit-test in isolation.
 */
export function parseCatalog(payload: unknown): ParseResult {
  if (!isObject(payload)) return { ok: false, reason: 'catalog is not an object' };

  const { gameVersion, trials } = payload;
  if (typeof gameVersion !== 'string' || gameVersion === '') {
    return { ok: false, reason: 'gameVersion must be a non-empty string' };
  }
  if (!Array.isArray(trials)) return { ok: false, reason: 'trials must be an array' };

  const entries: CatalogEntry[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < trials.length; i++) {
    const parsed = parseEntry(trials[i], i);
    if (typeof parsed === 'string') return { ok: false, reason: parsed };
    if (seen.has(parsed.id)) return { ok: false, reason: `duplicate trial id: ${parsed.id}` };
    seen.add(parsed.id);
    entries.push(parsed);
  }

  return { ok: true, catalog: { gameVersion, trials: entries } };
}

/**
 * Map a validated catalog into `trials` table rows. Pure — the catalog's
 * `gameVersion` is stamped onto every row. Testable without a DB.
 */
export function toTrialRows(catalog: TrialCatalog): TrialRow[] {
  return catalog.trials.map((t) => ({
    id: t.id,
    tier: t.tier,
    title: t.title,
    par: t.par,
    game_version: catalog.gameVersion,
  }));
}

export type SyncResult =
  | { ok: true; synced: number; gameVersion: string }
  | { ok: false; status: number; reason: string };

/**
 * Validate `payload` then upsert it into the `trials` catalog (by primary-key
 * `id`). Uses the passed-in client — the route hands in the service client,
 * which bypasses RLS. Returns the count synced or a reason.
 */
export async function syncTrials(db: SupabaseClient, payload: unknown): Promise<SyncResult> {
  const parsed = parseCatalog(payload);
  if (!parsed.ok) return { ok: false, status: 422, reason: parsed.reason };

  const rows = toTrialRows(parsed.catalog);
  if (rows.length === 0) {
    return { ok: true, synced: 0, gameVersion: parsed.catalog.gameVersion };
  }

  const { error } = await db.from('trials').upsert(rows, { onConflict: 'id' });
  if (error) return { ok: false, status: 500, reason: `trials upsert: ${error.message}` };

  return { ok: true, synced: rows.length, gameVersion: parsed.catalog.gameVersion };
}
