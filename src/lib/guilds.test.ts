import { describe, expect, it, vi } from 'vitest';

import {
  isGlobalModerator,
  isModerator,
  parseModeratorHandles,
  githubIdentityFromUser,
  readAccessTokenFromCookies,
} from './auth';
import {
  acceptInvite,
  createGuild,
  generateInviteToken,
  isValidInviteToken,
  isValidSlug,
  sanitizeSlug,
} from './guilds';

// ── Slug ──────────────────────────────────────────────────────────────────────

describe('sanitizeSlug', () => {
  it('lowercases and dashes unsafe runs', () => {
    expect(sanitizeSlug('The Iron Brigade')).toBe('the-iron-brigade');
    expect(sanitizeSlug('Knights of !!! the Realm')).toBe('knights-of-the-realm');
  });

  it('trims leading/trailing dashes and collapses repeats', () => {
    expect(sanitizeSlug('---Order--of--Vim---')).toBe('order-of-vim');
  });

  it('returns empty for degenerate input (no default — slugs must be chosen)', () => {
    expect(sanitizeSlug('')).toBe('');
    expect(sanitizeSlug('!!!')).toBe('');
    expect(sanitizeSlug('---')).toBe('');
  });
});

describe('isValidSlug', () => {
  it('accepts a canonical slug', () => {
    expect(isValidSlug('the-iron-brigade')).toBe(true);
  });

  it('rejects empty, over-long, and non-canonical slugs', () => {
    expect(isValidSlug('')).toBe(false);
    expect(isValidSlug('a'.repeat(49))).toBe(false);
    expect(isValidSlug('Has Caps')).toBe(false);
    expect(isValidSlug('-leading')).toBe(false);
    expect(isValidSlug('trailing-')).toBe(false);
    expect(isValidSlug('double--dash')).toBe(false);
  });
});

// ── Invite tokens ──────────────────────────────────────────────────────────────

describe('invite tokens', () => {
  it('generates 64-char lowercase hex tokens', () => {
    const t = generateInviteToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
    expect(isValidInviteToken(t)).toBe(true);
  });

  it('generates distinct tokens', () => {
    expect(generateInviteToken()).not.toBe(generateInviteToken());
  });

  it('rejects malformed tokens', () => {
    expect(isValidInviteToken('')).toBe(false);
    expect(isValidInviteToken('XYZ')).toBe(false);
    expect(isValidInviteToken('A'.repeat(64))).toBe(false); // uppercase
    expect(isValidInviteToken('a'.repeat(63))).toBe(false); // too short
  });
});

// ── Moderator env parsing ──────────────────────────────────────────────────────

describe('parseModeratorHandles', () => {
  it('splits, trims, lowercases, drops blanks', () => {
    const set = parseModeratorHandles(' Alice, BOB ,, carol ');
    expect([...set].sort()).toEqual(['alice', 'bob', 'carol']);
  });

  it('handles undefined / empty', () => {
    expect(parseModeratorHandles(undefined).size).toBe(0);
    expect(parseModeratorHandles('').size).toBe(0);
    expect(parseModeratorHandles(' , , ').size).toBe(0);
  });
});

describe('isGlobalModerator', () => {
  it('matches case-insensitively against the env list', () => {
    expect(isGlobalModerator('Alice', 'alice,bob')).toBe(true);
    expect(isGlobalModerator('ALICE', 'alice,bob')).toBe(true);
    expect(isGlobalModerator('mallory', 'alice,bob')).toBe(false);
  });
});

describe('isModerator', () => {
  it('short-circuits true for a global moderator without touching the db', async () => {
    const db = { from: vi.fn() } as never;
    const ok = await isModerator('Alice', { env: 'alice', db });
    expect(ok).toBe(true);
    expect((db as { from: ReturnType<typeof vi.fn> }).from).not.toHaveBeenCalled();
  });

  it('returns true when the player owns/mods a guild', async () => {
    const limit = vi.fn().mockResolvedValue({ data: [{ role: 'owner' }], error: null });
    const inFn = vi.fn().mockReturnValue({ limit });
    const eq = vi.fn().mockReturnValue({ in: inFn });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    const db = { from } as never;

    const ok = await isModerator('carol', { env: 'alice,bob', db });
    expect(ok).toBe(true);
    expect(from).toHaveBeenCalledWith('guild_members');
  });

  it('returns false when not global and not an owner/mod', async () => {
    const limit = vi.fn().mockResolvedValue({ data: [], error: null });
    const inFn = vi.fn().mockReturnValue({ limit });
    const eq = vi.fn().mockReturnValue({ in: inFn });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    const db = { from } as never;

    const ok = await isModerator('nobody', { env: 'alice', db });
    expect(ok).toBe(false);
  });
});

// ── GitHub identity mapping ────────────────────────────────────────────────────

describe('githubIdentityFromUser', () => {
  it('reads handle (lowercased) and numeric id from user_metadata', () => {
    const user = {
      user_metadata: { user_name: 'CaptainNobody1', provider_id: '12345' },
    } as never;
    expect(githubIdentityFromUser(user)).toEqual({ handle: 'captainnobody1', githubId: 12345 });
  });

  it('falls back through preferred_username / nickname', () => {
    const user = { user_metadata: { preferred_username: 'Knight', sub: 7 } } as never;
    expect(githubIdentityFromUser(user)).toEqual({ handle: 'knight', githubId: 7 });
  });

  it('returns null githubId when no numeric id is present', () => {
    const user = { user_metadata: { user_name: 'solo' } } as never;
    expect(githubIdentityFromUser(user)).toEqual({ handle: 'solo', githubId: null });
  });

  it('returns null when there is no handle', () => {
    expect(githubIdentityFromUser({ user_metadata: {} } as never)).toBeNull();
  });
});

// ── Cookie session read ─────────────────────────────────────────────────────────

describe('readAccessTokenFromCookies', () => {
  it('reads the access_token from a JSON object cookie', () => {
    const token = readAccessTokenFromCookies([
      { name: 'sb-abcd-auth-token', value: JSON.stringify({ access_token: 'tok-1' }) },
    ]);
    expect(token).toBe('tok-1');
  });

  it('reads the first element of a JSON array cookie', () => {
    const token = readAccessTokenFromCookies([
      { name: 'sb-abcd-auth-token', value: JSON.stringify(['tok-arr', 'refresh']) },
    ]);
    expect(token).toBe('tok-arr');
  });

  it('reassembles chunked cookies in order', () => {
    const json = JSON.stringify({ access_token: 'chunked-token-value' });
    const mid = Math.floor(json.length / 2);
    const token = readAccessTokenFromCookies([
      { name: 'sb-abcd-auth-token.1', value: json.slice(mid) },
      { name: 'sb-abcd-auth-token.0', value: json.slice(0, mid) },
    ]);
    expect(token).toBe('chunked-token-value');
  });

  it('decodes a base64- prefixed cookie value', () => {
    const json = JSON.stringify({ access_token: 'b64-token' });
    const encoded = 'base64-' + Buffer.from(json, 'utf8').toString('base64');
    expect(
      readAccessTokenFromCookies([{ name: 'sb-abcd-auth-token', value: encoded }]),
    ).toBe('b64-token');
  });

  it('returns null when there is no auth cookie', () => {
    expect(readAccessTokenFromCookies([{ name: 'other', value: 'x' }])).toBeNull();
    expect(readAccessTokenFromCookies([])).toBeNull();
  });
});

// ── Write helpers (mocked db) ───────────────────────────────────────────────────

describe('createGuild', () => {
  it('rejects a name that yields no valid slug', async () => {
    const db = { from: vi.fn() } as never;
    const res = await createGuild(db, { name: '!!!', ownerId: 'p1' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(400);
  });

  it('inserts the guild then seeds the owner membership', async () => {
    const guildRow = {
      id: 'g1',
      slug: 'the-iron-brigade',
      name: 'The Iron Brigade',
      is_private: true,
      owner_id: 'p1',
      created_at: '2026-01-01T00:00:00Z',
    };
    const memberInsert = vi.fn().mockResolvedValue({ error: null });
    const single = vi.fn().mockResolvedValue({ data: guildRow, error: null });
    const guildSelect = vi.fn().mockReturnValue({ single });
    const guildInsert = vi.fn().mockReturnValue({ select: guildSelect });
    const from = vi.fn((table: string) =>
      table === 'guilds' ? { insert: guildInsert } : { insert: memberInsert },
    );
    const db = { from } as never;

    const res = await createGuild(db, { name: 'The Iron Brigade', ownerId: 'p1' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.slug).toBe('the-iron-brigade');
    expect(guildInsert).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'the-iron-brigade', name: 'The Iron Brigade', owner_id: 'p1' }),
    );
    expect(memberInsert).toHaveBeenCalledWith({ guild_id: 'g1', player_id: 'p1', role: 'owner' });
  });

  it('maps a unique-violation to a 409', async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: { code: '23505', message: 'dup' } });
    const guildSelect = vi.fn().mockReturnValue({ single });
    const guildInsert = vi.fn().mockReturnValue({ select: guildSelect });
    const from = vi.fn().mockReturnValue({ insert: guildInsert });
    const db = { from } as never;

    const res = await createGuild(db, { name: 'Taken', ownerId: 'p1' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(409);
  });
});

describe('acceptInvite', () => {
  it('rejects a malformed token before any db call', async () => {
    const db = { from: vi.fn() } as never;
    const res = await acceptInvite(db, 'nope', 'p1');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(400);
    expect((db as { from: ReturnType<typeof vi.fn> }).from).not.toHaveBeenCalled();
  });

  it('404s when the token is unknown', async () => {
    const token = 'a'.repeat(64);
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    const db = { from } as never;

    const res = await acceptInvite(db, token, 'p1');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(404);
  });

  it('410s on an expired invite', async () => {
    const token = 'b'.repeat(64);
    const invite = {
      id: 'i1',
      guild_id: 'g1',
      token,
      email: null,
      expires_at: '2000-01-01T00:00:00Z',
      used_by: null,
    };
    const maybeSingle = vi.fn().mockResolvedValue({ data: invite, error: null });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    const db = { from } as never;

    const res = await acceptInvite(db, token, 'p1');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(410);
  });

  it('409s on an invite already used by someone else', async () => {
    const token = 'c'.repeat(64);
    const invite = {
      id: 'i1',
      guild_id: 'g1',
      token,
      email: null,
      expires_at: null,
      used_by: 'someone-else',
    };
    const maybeSingle = vi.fn().mockResolvedValue({ data: invite, error: null });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    const db = { from } as never;

    const res = await acceptInvite(db, token, 'p1');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(409);
  });
});
