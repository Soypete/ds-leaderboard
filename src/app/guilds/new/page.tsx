import { cookies } from 'next/headers';
import Link from 'next/link';

import { currentPlayer } from '@/lib/auth';
import { serviceClient } from '@/lib/db';
import { createGuild } from '@/lib/guilds';
import { NewGuildForm, type CreateGuildState } from '../NewGuildForm';

// Reads the auth cookie + writes via a server action — never static.
export const dynamic = 'force-dynamic';

/**
 * Server action: muster a guild owned by the current player. Authenticates from
 * the auth cookie, then delegates persistence to lib/guilds.createGuild (service
 * client). Returns a plain state object the client form can act on.
 */
async function createGuildAction(formData: FormData): Promise<CreateGuildState> {
  'use server';

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, reason: 'Service role key not configured.' };
  }

  const jar = await cookies();
  const player = await currentPlayer(jar.getAll());
  if (!player) return { ok: false, reason: 'Sign in with GitHub to muster a guild.' };

  const name = String(formData.get('name') ?? '').trim();
  const isPrivate = formData.get('isPrivate') != null;

  const res = await createGuild(serviceClient(), { name, isPrivate, ownerId: player.id });
  if (!res.ok) return { ok: false, reason: res.reason };
  return { ok: true, slug: res.value.slug };
}

export default async function NewGuildPage() {
  const configured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  let signedIn = false;
  if (configured) {
    const jar = await cookies();
    signedIn = (await currentPlayer(jar.getAll())) != null;
  }

  return (
    <>
      <p style={{ marginBottom: '0.25rem' }}>
        <Link href="/guilds">← All guilds</Link>
      </p>
      <h1>Muster a Guild</h1>
      <p className="empty" style={{ padding: '0.5rem 0' }}>
        Raise a banner and you become its owner. Private guilds keep their boards
        to members; invite your warband with a war-banner link.
      </p>

      {!configured ? (
        <p className="empty">
          Supabase / auth is not configured yet — set env vars to muster a guild.
        </p>
      ) : !signedIn ? (
        <p className="empty">
          <Link href="/login">Sign in with GitHub</Link> to muster a guild.
        </p>
      ) : (
        <NewGuildForm action={createGuildAction} />
      )}
    </>
  );
}
