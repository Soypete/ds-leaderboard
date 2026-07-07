'use client';

import { useState } from 'react';

/** The result a create action returns to the form. */
export interface CreateGuildState {
  ok: boolean;
  reason?: string;
  slug?: string;
}

/**
 * Client form for mustering a guild. Calls the passed server action; on success
 * it navigates to the new guild's board. Kept dumb — all validation/persistence
 * lives server-side in the action (which uses lib/guilds.createGuild).
 */
export function NewGuildForm({
  action,
  disabled,
}: {
  action: (formData: FormData) => Promise<CreateGuildState>;
  disabled?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    const res = await action(formData);
    setPending(false);
    if (res.ok && res.slug) {
      window.location.href = `/guilds/${encodeURIComponent(res.slug)}`;
    } else {
      setError(res.reason ?? 'Something went wrong mustering the guild.');
    }
  }

  return (
    <form action={onSubmit}>
      <p>
        <label>
          <span style={{ display: 'block', color: 'var(--steel)', fontSize: '0.8rem' }}>
            Guild name
          </span>
          <input
            name="name"
            required
            maxLength={64}
            placeholder="The Iron Brigade"
            disabled={disabled || pending}
            style={{
              fontFamily: 'inherit',
              background: 'var(--panel)',
              color: 'var(--ink)',
              border: '1px solid var(--steel)',
              borderRadius: '0.25rem',
              padding: '0.3rem 0.5rem',
              width: '100%',
              maxWidth: '24rem',
            }}
          />
        </label>
      </p>

      <p>
        <label style={{ color: 'var(--parchment)' }}>
          <input name="isPrivate" type="checkbox" defaultChecked disabled={disabled || pending} />{' '}
          Private — only members (and invitees) see the board
        </label>
      </p>

      {error && <p className="empty" style={{ color: 'var(--ember)' }}>{error}</p>}

      <p>
        <button className="btn approve" type="submit" disabled={disabled || pending}>
          {pending ? 'Mustering…' : '⚔ Muster the guild'}
        </button>
      </p>
    </form>
  );
}
