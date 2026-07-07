import { githubSignInUrl } from '@/lib/auth';

// Auth depends on per-request env + redirect host; never static-gen it.
export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  const url = await githubSignInUrl(`${base}/api/auth/callback`);

  return (
    <>
      <h1>Take the Oath</h1>
      <p className="empty" style={{ padding: '0.5rem 0' }}>
        Sign in with GitHub to muster a guild, accept a war-banner, and ride for a
        private board. Your handle is your sigil — the same one your runs carry.
      </p>

      {url ? (
        <p>
          <a className="btn" href={url}>
            ⚔ Sign in with GitHub
          </a>
        </p>
      ) : (
        <p className="empty">
          Auth is not configured yet — set the Supabase env vars and enable the
          GitHub provider to open the gates.
        </p>
      )}
    </>
  );
}
