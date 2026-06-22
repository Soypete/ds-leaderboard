import { cookies } from 'next/headers';
import Link from 'next/link';

import { currentPlayer } from '@/lib/auth';
import { browserClient, serviceClient } from '@/lib/db';
import { listPlayerGuilds, listPublicGuilds, type GuildRow } from '@/lib/guilds';

// Reads the auth cookie to show the signed-in user's guilds — must be dynamic.
export const dynamic = 'force-dynamic';

interface GuildsData {
  publicGuilds: GuildRow[];
  myGuilds: GuildRow[];
  signedIn: boolean;
  error: string | null;
}

async function loadGuilds(): Promise<GuildsData> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return {
      publicGuilds: [],
      myGuilds: [],
      signedIn: false,
      error: 'Supabase is not configured yet — set env vars to see the guilds.',
    };
  }
  try {
    const publicGuilds = await listPublicGuilds(browserClient(), { limit: 100 });

    let myGuilds: GuildRow[] = [];
    let signedIn = false;
    const jar = await cookies();
    const player = await currentPlayer(jar.getAll());
    if (player && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      signedIn = true;
      myGuilds = await listPlayerGuilds(serviceClient(), player.id);
    }

    return { publicGuilds, myGuilds, signedIn, error: null };
  } catch (err) {
    return { publicGuilds: [], myGuilds: [], signedIn: false, error: (err as Error).message };
  }
}

function GuildTable({ rows }: { rows: GuildRow[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Guild</th>
          <th>Banner</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((g) => (
          <tr key={g.id}>
            <td>
              <Link href={`/guilds/${encodeURIComponent(g.slug)}`}>{g.name}</Link>
            </td>
            <td>
              <span className="badge">{g.is_private ? 'private' : 'open'}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function GuildsPage() {
  const { publicGuilds, myGuilds, signedIn, error } = await loadGuilds();

  return (
    <>
      <h1>Guilds</h1>
      <p className="empty" style={{ padding: '0.5rem 0' }}>
        Muster a warband for a private board, or join an open guild. Members ride
        the same gold and trial boards — scoped to the guild alone.
      </p>

      <p>
        <Link className="btn" href="/guilds/new">
          ⚔ Muster a new guild
        </Link>
      </p>

      {error ? (
        <p className="empty">{error}</p>
      ) : (
        <>
          {signedIn && (
            <section>
              <h2 style={{ color: 'var(--banner)' }}>Your guilds</h2>
              {myGuilds.length === 0 ? (
                <p className="empty">You ride alone. Muster a guild or accept a war-banner.</p>
              ) : (
                <GuildTable rows={myGuilds} />
              )}
            </section>
          )}

          <section>
            <h2 style={{ color: 'var(--banner)' }}>Open guilds</h2>
            {publicGuilds.length === 0 ? (
              <p className="empty">No open guilds yet. Be the first to raise a banner.</p>
            ) : (
              <GuildTable rows={publicGuilds} />
            )}
          </section>

          {!signedIn && (
            <p className="empty" style={{ paddingTop: '0.5rem' }}>
              <Link href="/login">Sign in</Link> to see your private guilds.
            </p>
          )}
        </>
      )}
    </>
  );
}
