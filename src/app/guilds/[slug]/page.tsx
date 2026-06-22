import { cookies } from 'next/headers';
import Link from 'next/link';

import { currentPlayer } from '@/lib/auth';
import { browserClient, serviceClient } from '@/lib/db';
import {
  getGuildBySlug,
  guildGoldBoard,
  guildTrialBoard,
  listGuildMembers,
  type GuildGoldRow,
  type GuildMemberRow,
  type GuildRow,
  type GuildTrialRow,
} from '@/lib/guilds';

// Reads the auth cookie to gate private boards to members — must be dynamic.
export const dynamic = 'force-dynamic';

interface GuildData {
  guild: GuildRow | null;
  members: GuildMemberRow[];
  gold: GuildGoldRow[];
  trials: GuildTrialRow[];
  isMember: boolean;
  error: string | null;
  notConfigured: boolean;
}

async function loadGuild(slug: string): Promise<GuildData> {
  const empty = { guild: null, members: [], gold: [], trials: [], isMember: false };
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return { ...empty, error: null, notConfigured: true };
  }

  try {
    const anon = browserClient();

    // Find the current player (if signed in) so we can use the service client to
    // read a private guild they belong to. (The minimal cookie auth path doesn't
    // forward the user's JWT to PostgREST, so we gate membership here in the
    // server component and read with the service role. @supabase/ssr would let
    // RLS do this directly with the member's token — see src/lib/auth.ts.)
    const jar = await cookies();
    const player = process.env.SUPABASE_SERVICE_ROLE_KEY
      ? await currentPlayer(jar.getAll())
      : null;

    // Public-guild lookups work on anon; private ones resolve via the service
    // client only after we've confirmed membership below.
    let guild = await getGuildBySlug(anon, slug);
    let isMember = false;

    if (player && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const svc = serviceClient();
      // Resolve the guild via the service client if anon couldn't (private).
      guild = guild ?? (await getGuildBySlug(svc, slug));
      if (guild) {
        const members = await listGuildMembers(svc, guild.id);
        isMember = members.some((m) => m.playerId === player.id);
        if (isMember) {
          const [gold, trials] = await Promise.all([
            guildGoldBoard(svc, guild.id),
            guildTrialBoard(svc, guild.id),
          ]);
          return { guild, members, gold, trials, isMember, error: null, notConfigured: false };
        }
      }
    }

    if (!guild) {
      return { ...empty, error: null, notConfigured: false };
    }

    // Non-member view: only public guilds expose their roster/boards via RLS.
    if (!guild.is_private) {
      const [members, gold, trials] = await Promise.all([
        listGuildMembers(anon, guild.id),
        guildGoldBoard(anon, guild.id),
        guildTrialBoard(anon, guild.id),
      ]);
      return { guild, members, gold, trials, isMember, error: null, notConfigured: false };
    }

    return { guild, members: [], gold: [], trials: [], isMember, error: null, notConfigured: false };
  } catch (err) {
    return {
      guild: null,
      members: [],
      gold: [],
      trials: [],
      isMember: false,
      error: (err as Error).message,
      notConfigured: false,
    };
  }
}

function formatTime(ms: number): string {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  if (minutes > 0) return `${minutes}:${seconds.toFixed(3).padStart(6, '0')}`;
  return `${seconds.toFixed(3)}s`;
}

export default async function GuildBoardPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { guild, members, gold, trials, isMember, error, notConfigured } = await loadGuild(slug);

  return (
    <>
      <p style={{ marginBottom: '0.25rem' }}>
        <Link href="/guilds">← All guilds</Link>
      </p>
      <h1>{guild?.name ?? slug}</h1>

      {notConfigured ? (
        <p className="empty">Supabase is not configured yet — set env vars to see this guild.</p>
      ) : error ? (
        <p className="empty">{error}</p>
      ) : !guild ? (
        <p className="empty">No such guild — or its gates are barred to you.</p>
      ) : guild.is_private && !isMember ? (
        <p className="empty">
          This is a private guild. <Link href="/login">Sign in</Link> as a member, or
          ride in on a war-banner (an invite link) to see its boards.
        </p>
      ) : (
        <>
          <p className="empty" style={{ padding: '0.5rem 0' }}>
            <span className="badge">{guild.is_private ? 'private' : 'open'}</span> — the
            guild&apos;s own gold and trial boards, scoped to its members alone.
          </p>

          <section>
            <h2 style={{ color: 'var(--banner)' }}>Gold Earned in a Day</h2>
            {gold.length === 0 ? (
              <p className="empty">No approved hauls yet. Be the first of the guild to ride.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th className="rank">#</th>
                    <th>Knight</th>
                    <th>Gold</th>
                    <th>Day</th>
                  </tr>
                </thead>
                <tbody>
                  {gold.map((r, i) => (
                    <tr key={r.runId}>
                      <td className="rank">{i + 1}</td>
                      <td>
                        <a href={`https://github.com/${r.handle}`} target="_blank" rel="noreferrer">
                          {r.handle}
                        </a>
                      </td>
                      <td className="gold">⛁ {r.gold.toLocaleString()}</td>
                      <td>{r.day}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section>
            <h2 style={{ color: 'var(--banner)' }}>Trial Speedruns</h2>
            {trials.length === 0 ? (
              <p className="empty">No approved clears yet. Draw steel and set the pace.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Trial</th>
                    <th>Knight</th>
                    <th>Time</th>
                    <th>Keys</th>
                  </tr>
                </thead>
                <tbody>
                  {trials.map((r) => (
                    <tr key={r.runId}>
                      <td>
                        <Link href={`/trials/${encodeURIComponent(r.trialId)}`}>{r.trialId}</Link>
                      </td>
                      <td>
                        <a href={`https://github.com/${r.handle}`} target="_blank" rel="noreferrer">
                          {r.handle}
                        </a>
                      </td>
                      <td className="gold">{formatTime(r.durationMs)}</td>
                      <td>{r.keystrokes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section>
            <h2 style={{ color: 'var(--banner)' }}>Roster</h2>
            {members.length === 0 ? (
              <p className="empty">No members on the rolls.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Knight</th>
                    <th>Rank</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.playerId}>
                      <td>
                        <a href={`https://github.com/${m.handle}`} target="_blank" rel="noreferrer">
                          {m.handle}
                        </a>
                      </td>
                      <td>
                        <span className="badge">{m.role}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </>
  );
}
