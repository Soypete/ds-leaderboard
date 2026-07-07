import { describe, expect, it, vi } from 'vitest';

import {
  BOARD_MEDIA_KIND,
  buildStorageKey,
  recordMediaAsset,
  sanitizeFilename,
} from './storage';

describe('sanitizeFilename', () => {
  it('lowercases and keeps safe characters', () => {
    expect(sanitizeFilename('My-Run_01.PNG')).toBe('my-run_01.png');
  });

  it('strips directory parts (no path traversal)', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('a\\b\\c.mp4')).toBe('c.mp4');
  });

  it('collapses unsafe runs into a single dash', () => {
    expect(sanitizeFilename('hello world!!! .png')).toBe('hello-world-.png');
  });

  it('drops leading dots and dashes', () => {
    expect(sanitizeFilename('...hidden.png')).toBe('hidden.png');
    expect(sanitizeFilename('---weird')).toBe('weird');
  });

  it('falls back to a stable default for degenerate names', () => {
    expect(sanitizeFilename('')).toBe('upload');
    expect(sanitizeFilename('///')).toBe('upload');
    expect(sanitizeFilename('...')).toBe('upload');
  });
});

describe('buildStorageKey', () => {
  it('prefixes gold runs with gold/', () => {
    expect(buildStorageKey('daily_gold_runs', 'run-123', 'shot.png')).toBe(
      'gold/run-123/shot.png',
    );
  });

  it('prefixes trial runs with trial/', () => {
    expect(buildStorageKey('trial_runs', 'run-456', 'clip.mp4')).toBe(
      'trial/run-456/clip.mp4',
    );
  });

  it('sanitizes both the runId and the filename', () => {
    expect(buildStorageKey('daily_gold_runs', '../evil', '../../x y.PNG')).toBe(
      'gold/evil/x-y.png',
    );
  });
});

describe('BOARD_MEDIA_KIND', () => {
  it('maps gold to screenshot and trial to video', () => {
    expect(BOARD_MEDIA_KIND.daily_gold_runs).toBe('screenshot');
    expect(BOARD_MEDIA_KIND.trial_runs).toBe('video');
  });
});

/** A fake Supabase client with a chainable .from().insert() that records calls. */
function fakeDb() {
  const insert = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn().mockReturnValue({ insert });
  // The shape recordMediaAsset uses; cast through unknown for the test double.
  return { client: { from } as unknown as Parameters<typeof recordMediaAsset>[0], from, insert };
}

describe('recordMediaAsset', () => {
  it('rejects when neither run fk is set (XOR)', async () => {
    const { client, insert } = fakeDb();
    const res = await recordMediaAsset(client, { kind: 'screenshot', storagePath: 'gold/a/x.png' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });

  it('rejects when both run fks are set (XOR)', async () => {
    const { client, insert } = fakeDb();
    const res = await recordMediaAsset(client, {
      kind: 'video',
      storagePath: 'trial/a/x.mp4',
      dailyRunId: 'd1',
      trialRunId: 't1',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });

  it('inserts a gold screenshot row with the daily fk set', async () => {
    const { client, from, insert } = fakeDb();
    const res = await recordMediaAsset(client, {
      kind: 'screenshot',
      storagePath: 'gold/run-1/shot.png',
      byteSize: 2048,
      dailyRunId: 'run-1',
    });
    expect(res.ok).toBe(true);
    expect(from).toHaveBeenCalledWith('media_assets');
    expect(insert).toHaveBeenCalledWith({
      kind: 'screenshot',
      storage_path: 'gold/run-1/shot.png',
      byte_size: 2048,
      daily_run_id: 'run-1',
      trial_run_id: null,
      uploaded_by: null,
    });
  });

  it('inserts a trial video row with the trial fk set and null byteSize', async () => {
    const { client, insert } = fakeDb();
    const res = await recordMediaAsset(client, {
      kind: 'video',
      storagePath: 'trial/run-2/clip.mp4',
      trialRunId: 'run-2',
    });
    expect(res.ok).toBe(true);
    expect(insert).toHaveBeenCalledWith({
      kind: 'video',
      storage_path: 'trial/run-2/clip.mp4',
      byte_size: null,
      daily_run_id: null,
      trial_run_id: 'run-2',
      uploaded_by: null,
    });
  });

  it('surfaces an insert error as a 500', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { message: 'boom' } });
    const from = vi.fn().mockReturnValue({ insert });
    const client = { from } as unknown as Parameters<typeof recordMediaAsset>[0];
    const res = await recordMediaAsset(client, {
      kind: 'screenshot',
      storagePath: 'gold/a/x.png',
      dailyRunId: 'a',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(500);
      expect(res.reason).toContain('boom');
    }
  });
});
