import { cookies } from 'next/headers';
import Link from 'next/link';

import { currentPlayer } from '@/lib/auth';
import { serviceClient } from '@/lib/db';
import { acceptInvite, isValidInviteToken } from '@/lib/guilds';

// Reads the auth cookie + joins the guild — never static.
export const dynamic = 'force-dynamic';

interface AcceptState {
  state: 'not-configured' | 'bad-token' | 'sign-in' | 'joined' | 'error';
  reason?: string;
  slug?: string;
  name?: string;
}

async function accept(token: string): Promise<AcceptState> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { state: 'not-configured' };
  }
  if (!isValidInviteToken(token)) return { state: 'bad-token' };

  const jar = await cookies();
  const player = await currentPlayer(jar.getAll());
  if (!player) return { state: 'sign-in' };

  const res = await acceptInvite(serviceClient(), token, player.id);
  if (!res.ok) return { state: 'error', reason: res.reason };
  return { state: 'joined', slug: res.value.slug, name: res.value.name };
}

export default async function AcceptInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await accept(token);

  return (
    <>
      <h1>A War-Banner</h1>

      {result.state === 'not-configured' ? (
        <p className="empty">Supabase / auth is not configured yet — the banner can&apos;t be raised.</p>
      ) : result.state === 'bad-token' ? (
        <p className="empty">This banner is torn — the invite link is malformed.</p>
      ) : result.state === 'sign-in' ? (
        <p className="empty">
          <Link href="/login">Sign in with GitHub</Link> to take up this banner, then
          open the link again to join the guild.
        </p>
      ) : result.state === 'error' ? (
        <p className="empty" style={{ color: 'var(--ember)' }}>
          {result.reason ?? 'The banner could not be raised.'}
        </p>
      ) : (
        <p className="empty">
          You&apos;ve joined <strong>{result.name}</strong>. Ride to the{' '}
          <Link href={`/guilds/${encodeURIComponent(result.slug!)}`}>guild board</Link>.
        </p>
      )}
    </>
  );
}
