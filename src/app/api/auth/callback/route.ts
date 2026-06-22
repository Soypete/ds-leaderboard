/**
 * GET /api/auth/callback — the GitHub OAuth redirect target.
 *
 * Supabase redirects here with `?code=...` after the user authorizes GitHub. We
 * exchange the code for a session, write the session into the Supabase auth
 * cookie (the same `sb-<ref>-auth-token` cookie our `readAccessTokenFromCookies`
 * reads), upsert the player from the GitHub identity, then redirect home.
 *
 * NOTE ON DEPS: with `@supabase/ssr` (not installed; the brief forbids adding it)
 * the cookie write + token refresh would be handled by its server client/cookie
 * adapter. Here we mint the cookie by hand from the exchanged session. This is
 * the seam integration should replace with the ssr client.
 */

import { NextResponse } from 'next/server';

import { browserClient } from '@/lib/db';
import { githubIdentityFromUser, upsertPlayer } from '@/lib/auth';
import { serviceClient } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Derive the Supabase project ref from the URL — used for the cookie name. */
function projectRef(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  const match = url.match(/^https?:\/\/([^.]+)\./);
  return match ? match[1] : null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const home = new URL('/', url.origin);

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.redirect(new URL('/login?error=not-configured', url.origin));
  }
  if (!code) {
    return NextResponse.redirect(new URL('/login?error=missing-code', url.origin));
  }

  const { data, error } = await browserClient().auth.exchangeCodeForSession(code);
  if (error || !data?.session || !data.user) {
    return NextResponse.redirect(new URL('/login?error=exchange-failed', url.origin));
  }

  // Best-effort player upsert (service role). A failure here shouldn't block the
  // login; the player will be upserted again on the next authenticated request.
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const identity = githubIdentityFromUser(data.user);
    if (identity) {
      try {
        await upsertPlayer(serviceClient(), identity);
      } catch {
        // swallow — see note above.
      }
    }
  }

  const res = NextResponse.redirect(home);

  // Write the session into the Supabase auth cookie. We store the full token set
  // as the JSON array Supabase itself uses, so the rest of the app reads it the
  // same way regardless of how it was set. (@supabase/ssr would own this.)
  const ref = projectRef();
  if (ref) {
    const { session } = data;
    const payload = JSON.stringify([
      session.access_token,
      session.refresh_token,
      null, // provider_token
      null, // provider_refresh_token
      null, // user (omitted; getUser() validates the access_token)
    ]);
    res.cookies.set(`sb-${ref}-auth-token`, payload, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: session.expires_in ?? 3600,
    });
  }

  return res;
}
