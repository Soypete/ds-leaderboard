'use client';

import { useState } from 'react';

import type { GoldBoardRow } from '@/lib/boards';

/**
 * One pending run with approve/reject controls. Posts to /api/moderate with the
 * moderator secret (entered once, kept in-memory only — never persisted).
 *
 * MVP note: prompting for the secret per session is a stopgap until GitHub
 * OAuth + guild roles replace the shared secret.
 */
export function ModerateRow({ row }: { row: GoldBoardRow }) {
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function act(action: 'approved' | 'rejected') {
    const secret = window.sessionStorage.getItem('mod_secret') ?? window.prompt('Moderator secret');
    if (!secret) return;
    window.sessionStorage.setItem('mod_secret', secret);

    let note: string | null = null;
    if (action === 'rejected') {
      note = window.prompt('Reason for rejection (required)') ?? '';
      if (!note.trim()) return;
    }

    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/moderate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
        body: JSON.stringify({ board: 'daily_gold_runs', runId: row.runId, action, note }),
      });
      const body = (await res.json()) as { ok: boolean; reason?: string };
      if (body.ok) {
        setStatus(action);
      } else {
        setMsg(body.reason ?? 'failed');
        if (res.status === 401) window.sessionStorage.removeItem('mod_secret');
      }
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (status !== 'pending') {
    return (
      <tr>
        <td>{row.handle}</td>
        <td className="gold">⛁ {row.gold.toLocaleString()}</td>
        <td>{row.day}</td>
        <td>{row.receiptUrl ? <a href={row.receiptUrl}>receipt</a> : '—'}</td>
        <td>
          <span className={`badge ${status === 'approved' ? '' : 'pending'}`}>{status}</span>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td>{row.handle}</td>
      <td className="gold">⛁ {row.gold.toLocaleString()}</td>
      <td>{row.day}</td>
      <td>
        {row.receiptUrl ? (
          <a href={row.receiptUrl} target="_blank" rel="noreferrer">
            receipt
          </a>
        ) : (
          '—'
        )}
      </td>
      <td style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
        <button className="btn approve" disabled={busy} onClick={() => act('approved')}>
          approve
        </button>
        <button className="btn reject" disabled={busy} onClick={() => act('rejected')}>
          reject
        </button>
        {msg ? <span className="badge pending">{msg}</span> : null}
      </td>
    </tr>
  );
}
