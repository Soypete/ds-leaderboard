import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';

import { currentPlayer } from '@/lib/auth';
import { serviceClient } from '@/lib/db';
import {
  leaveGuild,
  removeMember,
  setMemberRole,
  transferOwnership,
  type GuildMemberRow,
  type GuildRole,
} from '@/lib/guilds';

/**
 * The guild roster plus ownership controls, gated by the viewer's role:
 *   - owner: promote/demote mods, remove members, transfer ownership, leave
 *   - mod:   remove plain members, leave
 *   - member: leave only
 *
 * Each control is a server action that RE-AUTHENTICATES the actor from the auth
 * cookie (never trusts a hidden field for identity) and re-checks the role in the
 * lib helper, so a forged form post can't escalate. Writes use the service client;
 * the action revalidates this guild's path so the roster re-renders.
 */
export function RosterControls({
  guildId,
  slug,
  members,
  viewerId,
  viewerRole,
}: {
  guildId: string;
  slug: string;
  members: GuildMemberRow[];
  viewerId: string | null;
  viewerRole: GuildRole | null;
}) {
  const path = `/guilds/${slug}`;

  // ── Server actions (each re-auths the actor; identity comes from the cookie) ──

  async function actorId(): Promise<string | null> {
    'use server';
    const jar = await cookies();
    const player = await currentPlayer(jar.getAll());
    return player?.id ?? null;
  }

  async function removeAction(formData: FormData): Promise<void> {
    'use server';
    const me = await actorId();
    const target = String(formData.get('playerId') ?? '');
    if (!me || !target || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;
    await removeMember(serviceClient(), { guildId, actorId: me, targetPlayerId: target });
    revalidatePath(path);
  }

  async function setRoleAction(formData: FormData): Promise<void> {
    'use server';
    const me = await actorId();
    const target = String(formData.get('playerId') ?? '');
    const role = String(formData.get('role') ?? '');
    if (!me || !target || (role !== 'mod' && role !== 'member')) return;
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return;
    await setMemberRole(serviceClient(), { guildId, actorId: me, targetPlayerId: target, role });
    revalidatePath(path);
  }

  async function transferAction(formData: FormData): Promise<void> {
    'use server';
    const me = await actorId();
    const target = String(formData.get('playerId') ?? '');
    if (!me || !target || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;
    await transferOwnership(serviceClient(), { guildId, actorId: me, newOwnerId: target });
    revalidatePath(path);
  }

  async function leaveAction(): Promise<void> {
    'use server';
    const me = await actorId();
    if (!me || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;
    await leaveGuild(serviceClient(), { guildId, playerId: me });
    revalidatePath(path);
  }

  const isOwner = viewerRole === 'owner';
  const isMod = viewerRole === 'mod';

  return (
    <>
      <table>
        <thead>
          <tr>
            <th>Knight</th>
            <th>Rank</th>
            {(isOwner || isMod) && <th>Manage</th>}
          </tr>
        </thead>
        <tbody>
          {members.map((m) => {
            const isSelf = m.playerId === viewerId;
            // Who can the viewer act on?
            const canRemove =
              !isSelf &&
              m.role !== 'owner' &&
              (isOwner || (isMod && m.role === 'member'));
            const canRerole = isOwner && !isSelf && m.role !== 'owner';
            const canCrown = isOwner && !isSelf && m.role !== 'owner';

            return (
              <tr key={m.playerId}>
                <td>
                  <a
                    className="handle"
                    href={`https://github.com/${m.handle}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {m.handle}
                  </a>
                  {isSelf ? <span className="roster-you">you</span> : null}
                </td>
                <td>
                  <span className={`badge${m.role === 'owner' ? ' owner' : ''}`}>{m.role}</span>
                </td>
                {(isOwner || isMod) && (
                  <td className="roster-actions">
                    {canRerole && m.role === 'member' && (
                      <form action={setRoleAction}>
                        <input type="hidden" name="playerId" value={m.playerId} />
                        <input type="hidden" name="role" value="mod" />
                        <button className="btn" type="submit">
                          make mod
                        </button>
                      </form>
                    )}
                    {canRerole && m.role === 'mod' && (
                      <form action={setRoleAction}>
                        <input type="hidden" name="playerId" value={m.playerId} />
                        <input type="hidden" name="role" value="member" />
                        <button className="btn" type="submit">
                          demote
                        </button>
                      </form>
                    )}
                    {canCrown && (
                      <form action={transferAction}>
                        <input type="hidden" name="playerId" value={m.playerId} />
                        <button className="btn" type="submit">
                          ⚑ make owner
                        </button>
                      </form>
                    )}
                    {canRemove && (
                      <form action={removeAction}>
                        <input type="hidden" name="playerId" value={m.playerId} />
                        <button className="btn reject" type="submit">
                          remove
                        </button>
                      </form>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      {viewerRole != null && (
        <form action={leaveAction} className="roster-leave">
          <button className="btn reject" type="submit">
            {isOwner ? 'Abdicate & leave' : 'Leave guild'}
          </button>
          {isOwner ? (
            <span className="roster-hint">
              The crown passes to your senior mod (or oldest member); if you ride alone,
              the guild disbands.
            </span>
          ) : null}
        </form>
      )}
    </>
  );
}
