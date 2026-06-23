/**
 * GET /api/dev/login?as=<handle>  —  DEV-ONLY fake GitHub session.
 *
 * Local OAuth testing without github.com: mints (or reuses) a confirmed Supabase
 * Auth user whose `user_metadata.user_name` is the given handle — exactly the
 * shape the real GitHub provider produces — signs in to get a genuine session,
 * and writes the same `sb-<ref>-auth-token` cookie the real OAuth callback sets
 * (src/app/api/auth/callback/route.ts). Every downstream check then runs for
 * real: currentUser → githubIdentityFromUser → currentPlayer → guild roles.
 *
 * HARD-GATED to local development. It refuses to run unless BOTH:
 *   - NODE_ENV !== 'production', AND
 *   - the Supabase URL points at localhost / 127.0.0.1 (the local stack).
 * It also requires the service-role key (admin API). It can never act against a
 * hosted project, so it cannot be used to forge a session in production.
 *
 *   open http://localhost:3000/api/dev/login?as=captainnobody1
 *   →    redirects home, signed in as that handle.
 *
 * Default handle: captainnobody1 (seeded owner of the 'roundtable' guild).
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** True only when we're clearly pointed at a local Supabase stack. */
function isLocalStack(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  return /(^https?:\/\/)?(127\.0\.0\.1|localhost|0\.0\.0\.0)(:|\/|$)/.test(url);
}

/** Derive the Supabase project ref for the cookie name (local refs work too). */
function projectRef(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  const match = url.match(/^https?:\/\/([^.:/]+)/);
  return match ? match[1] : null;
}

/** A stable, valid email + password for a given handle (local users only). */
function devCreds(handle: string): { email: string; password: string } {
  return { email: `${handle}@dev.local`, password: `dev-${handle}-password` };
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  if (!isLocalStack()) {
    return NextResponse.json(
      { ok: false, reason: 'dev login is disabled outside the local Supabase stack' },
      { status: 403 },
    );
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !serviceKey || !anonKey) {
    return NextResponse.json(
      { ok: false, reason: 'missing local Supabase env (URL / anon / service-role key)' },
      { status: 500 },
    );
  }

  const handle = (url.searchParams.get('as') ?? 'captainnobody1').trim().toLowerCase();
  if (!/^[a-z0-9-]{1,39}$/.test(handle)) {
    return NextResponse.json({ ok: false, reason: 'invalid handle' }, { status: 400 });
  }
  const { email, password } = devCreds(handle);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // If a player with this handle already exists (e.g. the seeded captainnobody1
  // with github_id 1001), REUSE its github_id so currentPlayer()'s upsert lands
  // on that exact row — otherwise signing in would fork a second player and you'd
  // miss the seeded guild ownership. New handles get a deterministic fake id.
  const { data: existingPlayer } = await admin
    .from('players')
    .select('github_id')
    .eq('github_handle', handle)
    .maybeSingle<{ github_id: number | null }>();
  const githubId = existingPlayer?.github_id ?? 2_000_000_000 + hashHandle(handle);

  // The GitHub provider stamps these onto user_metadata; mirror them so
  // githubIdentityFromUser() reads the same fields it would in production.
  const userMetadata = {
    user_name: handle,
    preferred_username: handle,
    provider_id: String(githubId),
  };

  // Create the user (idempotent: ignore "already registered"), then make sure its
  // metadata is current, then sign in to obtain a real session.
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: userMetadata,
  });
  if (created.error && !/registered|exists/i.test(created.error.message)) {
    return NextResponse.json(
      { ok: false, reason: `create dev user: ${created.error.message}` },
      { status: 500 },
    );
  }

  // Ensure metadata is set even if the user pre-existed (find by listing).
  if (created.error) {
    const list = await admin.auth.admin.listUsers();
    const existing = list.data?.users.find((u) => u.email === email);
    if (existing) {
      await admin.auth.admin.updateUserById(existing.id, { user_metadata: userMetadata });
    }
  }

  // Sign in with the anon client to mint a genuine access/refresh token pair.
  const signin = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await signin.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    return NextResponse.json(
      { ok: false, reason: `sign in dev user: ${error?.message ?? 'no session'}` },
      { status: 500 },
    );
  }

  const ref = projectRef();
  if (!ref) {
    return NextResponse.json({ ok: false, reason: 'cannot derive project ref' }, { status: 500 });
  }

  const res = NextResponse.redirect(new URL('/', url.origin));
  // Same JSON-array cookie shape the real callback writes, so the rest of the app
  // reads it identically (see auth/callback/route.ts).
  const payload = JSON.stringify([
    data.session.access_token,
    data.session.refresh_token,
    null,
    null,
    null,
  ]);
  res.cookies.set(`sb-${ref}-auth-token`, payload, {
    httpOnly: true,
    secure: false, // local http
    sameSite: 'lax',
    path: '/',
    maxAge: data.session.expires_in ?? 3600,
  });
  return res;
}

/** Tiny deterministic hash so each handle gets a stable fake numeric github id. */
function hashHandle(handle: string): number {
  let h = 0;
  for (let i = 0; i < handle.length; i++) {
    h = (h * 31 + handle.charCodeAt(i)) % 1_000_000_000;
  }
  return h;
}
