/**
 * The receipt contract — the cross-realm dispatch the Dragonslayer game seals
 * and the leaderboard ingests. This MUST stay byte-compatible with the game's
 * `src/types.ts` Receipt and `src/ui/receipt.ts` hashing, or hashes won't match.
 *
 * Source of truth: DragonSlayer repo, src/ui/receipt.ts (buildReceipt /
 * canonicalReceipt / hashReceipt). Mirror any change there into this file.
 */

import { createHash } from 'node:crypto';

export interface ReceiptTrial {
  trialId: string;
  durationMs: number;
  keystrokes: number;
  par: number;
  stars: 1 | 2 | 3;
  /** Epoch ms the scored run landed; 0 when the chronicle predates the stamp. */
  completedAt: number;
}

export interface Receipt {
  schema: 'dragonslayer-receipt/v1';
  gameVersion: string;
  saveVersion: number;
  githubHandle: string;
  repo: { sigil: string; name?: string };
  day: string;
  goldEarnedThatDay: number;
  trials: ReceiptTrial[];
  generatedAt: number;
  contentHash: string;
}

export const RECEIPT_SCHEMA = 'dragonslayer-receipt/v1' as const;

/**
 * The exact bytes the hash is taken over: a stable, whitespace-free render of
 * every field except `contentHash`, keys in a fixed order. Reproduces the
 * game's canonicalReceipt verbatim.
 */
export function canonicalReceipt(receipt: Omit<Receipt, 'contentHash'>): string {
  const ordered = {
    schema: receipt.schema,
    gameVersion: receipt.gameVersion,
    saveVersion: receipt.saveVersion,
    githubHandle: receipt.githubHandle,
    repo:
      receipt.repo.name === undefined
        ? { sigil: receipt.repo.sigil }
        : { sigil: receipt.repo.sigil, name: receipt.repo.name },
    day: receipt.day,
    goldEarnedThatDay: receipt.goldEarnedThatDay,
    trials: receipt.trials.map((t) => ({
      trialId: t.trialId,
      durationMs: t.durationMs,
      keystrokes: t.keystrokes,
      par: t.par,
      stars: t.stars,
      completedAt: t.completedAt,
    })),
    generatedAt: receipt.generatedAt,
  };
  return JSON.stringify(ordered);
}

/** sha256 hex over the canonical render. */
export function hashReceipt(receipt: Omit<Receipt, 'contentHash'>): string {
  return createHash('sha256').update(canonicalReceipt(receipt)).digest('hex');
}

/** Does a sealed receipt's hash still match its contents? */
export function verifyReceiptHash(receipt: Receipt): boolean {
  const { contentHash, ...rest } = receipt;
  return hashReceipt(rest) === contentHash;
}

// ── Structural validation ─────────────────────────────────────────────────────

export type ReceiptValidation =
  | { ok: true; receipt: Receipt }
  | { ok: false; reason: string };

function isReceiptTrial(v: unknown): v is ReceiptTrial {
  if (v === null || typeof v !== 'object') return false;
  const t = v as Record<string, unknown>;
  return (
    typeof t.trialId === 'string' &&
    typeof t.durationMs === 'number' &&
    typeof t.keystrokes === 'number' &&
    typeof t.par === 'number' &&
    (t.stars === 1 || t.stars === 2 || t.stars === 3) &&
    typeof t.completedAt === 'number'
  );
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse + structurally validate an untrusted payload and confirm its hash.
 * Returns the typed receipt on success, or a human-readable reason on failure.
 * Does NOT confirm authorship — that's the ingest layer's job (handle vs author).
 */
export function validateReceipt(payload: unknown): ReceiptValidation {
  if (payload === null || typeof payload !== 'object') {
    return { ok: false, reason: 'payload is not an object' };
  }
  const r = payload as Record<string, unknown>;

  if (r.schema !== RECEIPT_SCHEMA) {
    return { ok: false, reason: `unknown schema: ${String(r.schema)}` };
  }
  if (typeof r.gameVersion !== 'string') return { ok: false, reason: 'gameVersion missing' };
  if (typeof r.saveVersion !== 'number') return { ok: false, reason: 'saveVersion missing' };
  if (typeof r.githubHandle !== 'string' || r.githubHandle === '') {
    return { ok: false, reason: 'githubHandle missing' };
  }
  if (
    r.repo === null ||
    typeof r.repo !== 'object' ||
    typeof (r.repo as Record<string, unknown>).sigil !== 'string'
  ) {
    return { ok: false, reason: 'repo.sigil missing' };
  }
  if (typeof r.day !== 'string' || !DAY_RE.test(r.day)) {
    return { ok: false, reason: 'day must be YYYY-MM-DD' };
  }
  if (typeof r.goldEarnedThatDay !== 'number' || r.goldEarnedThatDay < 0) {
    return { ok: false, reason: 'goldEarnedThatDay must be a non-negative number' };
  }
  if (!Array.isArray(r.trials) || !r.trials.every(isReceiptTrial)) {
    return { ok: false, reason: 'trials malformed' };
  }
  if (typeof r.generatedAt !== 'number') return { ok: false, reason: 'generatedAt missing' };
  if (typeof r.contentHash !== 'string') return { ok: false, reason: 'contentHash missing' };

  const receipt = payload as Receipt;
  if (!verifyReceiptHash(receipt)) {
    return { ok: false, reason: 'contentHash does not match contents (tampered or stale)' };
  }
  return { ok: true, receipt };
}
