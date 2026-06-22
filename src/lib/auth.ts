/**
 * GitHub OAuth via Supabase Auth — sign-in, session read, the current player,
 * and the moderator check that REPLACES the shared-secret model.
 *
 * SERVER ONLY for the session/player/moderator helpers: they read the Supabase
 * auth cookie and (for player upsert) use the service client.
 *
 * NOTE ON DEPS: the production-grade way to wire Supabase Auth into Next 15's
 * App Router is `@supabase/ssr` (cookie adapter for server components + route
 * handlers + middleware refresh). That package is NOT installed and the brief
 * forbids adding it, so this module implements a MINIMAL cookie-based session
 * read directly with @supabase/supabase-js: it pulls the access token out of the
 * Supabase auth cookie and validates it with `auth.getUser(token)`. This does
 * not refresh expired tokens or persist a rotated session — `@supabase/ssr`
 * would. The seams below (`readAccessTokenFromCookies`, `currentUser`) are where
 * integration should swap in the ssr client.
 */

import type { SupabaseClient, User } from '@supabase/supabase-js';

import { browserClient, serviceClient, type PlayerRow } from './db';

// ── Sign-in URL ──────────────────────────────────────────────────────────────

/**
 * Build the GitHub OAuth sign-in URL via Supabase Auth. Supabase returns the URL
 * to redirect the browser to; `redirectTo` is our own callback route that will
 * exchange the code for a session. Returns null when auth env is absent (so the
 * login page can render a graceful "not configured" state).
 */
export async function githubSignInUrl(redirectTo: string): Promise<string | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
  const { data, error } = await browserClient().auth.signInWithOAuth({
    provider: 'github',
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error || !data?.url) return null;
  return data.url;
}

// ── Session read (minimal cookie path) ───────────────────────────────────────

/**
 * Pull the Supabase access token out of the auth cookie jar.
 *
 * Supabase stores the session under `sb-<project-ref>-auth-token`. The value is
 * either a JSON array/object containing `access_token`, or (when large) split
 * across `.0`, `.1`, … chunk cookies that concatenate into that JSON. We avoid
 * hard-coding the project ref by scanning for any `sb-*-auth-token*` cookie.
 *
 * This is the seam `@supabase/ssr` would own; kept deliberately small.
 */
export function readAccessTokenFromCookies(
  cookies: { name: string; value: string }[],
): string | null {
  const authCookies = cookies.filter(
    (c) => c.name.startsWith('sb-') && c.name.includes('-auth-token'),
  );
  if (authCookies.length === 0) return null;

  // Reassemble chunked cookies (`...-auth-token.0`, `.1`, …) in order.
  const base = authCookies.filter((c) => /-auth-token$/.test(c.name));
  const chunks = authCookies
    .filter((c) => /-auth-token\.\d+$/.test(c.name))
    .sort((a, b) => {
      const ai = Number(a.name.split('.').pop());
      const bi = Number(b.name.split('.').pop());
      return ai - bi;
    });

  let raw = base.map((c) => c.value).join('') + chunks.map((c) => c.value).join('');
  if (!raw) return null;

  // Supabase may base64-encode the cookie value (prefixed `base64-`).
  if (raw.startsWith('base64-')) {
    try {
      raw = Buffer.from(raw.slice('base64-'.length), 'base64').toString('utf8');
    } catch {
      return null;
    }
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return typeof parsed[0] === 'string' ? parsed[0] : null;
    if (parsed && typeof parsed.access_token === 'string') return parsed.access_token;
  } catch {
    // Fall through: some setups store the bare token.
    return raw || null;
  }
  return null;
}

/**
 * The authenticated Supabase user, or null. Validates the access token from the
 * cookie jar against Supabase Auth. Returns null when auth env is absent.
 */
export async function currentUser(
  cookies: { name: string; value: string }[],
): Promise<User | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
  const token = readAccessTokenFromCookies(cookies);
  if (!token) return null;
  const { data, error } = await browserClient().auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

// ── OAuth identity → players row ─────────────────────────────────────────────

/** The bits of a GitHub OAuth identity we map onto a players row. */
export interface GithubIdentity {
  githubId: number | null;
  handle: string; // lowercased
}

/**
 * Pull the GitHub handle + numeric id out of a Supabase user's metadata. The
 * GitHub provider stores `user_name` (login) and `provider_id`/`sub` (the
 * numeric id) in `user_metadata`. Pure so it can be unit-tested.
 */
export function githubIdentityFromUser(user: User): GithubIdentity | null {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const login = meta.user_name ?? meta.preferred_username ?? meta.nickname;
  const handle = typeof login === 'string' ? login.toLowerCase() : null;
  if (!handle) return null;

  const idRaw = meta.provider_id ?? meta.sub ?? null;
  const githubId =
    typeof idRaw === 'number'
      ? idRaw
      : typeof idRaw === 'string' && /^\d+$/.test(idRaw)
        ? Number(idRaw)
        : null;

  return { githubId, handle };
}

/**
 * Upsert the players row for a GitHub identity (by github_id when present, else
 * by handle) and return it. Service client — server only.
 */
export async function upsertPlayer(
  db: SupabaseClient,
  identity: GithubIdentity,
): Promise<PlayerRow> {
  // Upsert on github_id when we have it (survives handle renames); otherwise on
  // the unique handle. Both columns are unique in the schema.
  const onConflict = identity.githubId != null ? 'github_id' : 'github_handle';
  const { data, error } = await db
    .from('players')
    .upsert(
      { github_handle: identity.handle, github_id: identity.githubId },
      { onConflict },
    )
    .select('id, github_handle, github_id, created_at')
    .single<PlayerRow>();
  if (error) throw new Error(`upsert player: ${error.message}`);
  if (!data) throw new Error('upsert player: no row returned');
  return data;
}

/**
 * The players row for the current OAuth session, upserting it on first sight, or
 * null when nobody is signed in / auth isn't configured. Server only.
 */
export async function currentPlayer(
  cookies: { name: string; value: string }[],
): Promise<PlayerRow | null> {
  const user = await currentUser(cookies);
  if (!user) return null;
  const identity = githubIdentityFromUser(user);
  if (!identity) return null;
  return upsertPlayer(serviceClient(), identity);
}

// ── Moderator check (replaces the shared secret) ─────────────────────────────

/**
 * Parse MODERATOR_HANDLES (comma-separated, lowercased) into a Set. Pure +
 * tolerant of whitespace and empty entries.
 */
export function parseModeratorHandles(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter((h) => h.length > 0),
  );
}

/** Whether a handle is a global moderator per the env allow-list. Pure. */
export function isGlobalModerator(handle: string, raw: string | undefined): boolean {
  return parseModeratorHandles(raw).has(handle.toLowerCase());
}

/**
 * Whether `handle` may moderate: a global moderator (MODERATOR_HANDLES) OR an
 * owner/mod of any guild. The guild check uses the service client (server only).
 * Pass an explicit `db` in tests; defaults to the service client in prod.
 */
export async function isModerator(
  handle: string,
  opts: { db?: SupabaseClient; env?: string } = {},
): Promise<boolean> {
  const env = opts.env ?? process.env.MODERATOR_HANDLES;
  if (isGlobalModerator(handle, env)) return true;

  // No DB configured / available → fall back to the env allow-list only.
  if (!opts.db && !process.env.SUPABASE_SERVICE_ROLE_KEY) return false;
  const db = opts.db ?? serviceClient();

  const { data, error } = await db
    .from('guild_members')
    .select('role, players!inner(github_handle)')
    .eq('players.github_handle', handle.toLowerCase())
    .in('role', ['owner', 'mod'])
    .limit(1);
  if (error) return false;
  return (data ?? []).length > 0;
}
