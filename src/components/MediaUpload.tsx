'use client';

import { useState } from 'react';

import { browserClient, type MediaKind } from '@/lib/db';

/**
 * Reusable media uploader — the player-facing side of the two-step flow
 * (see HOSTING.md). Given a board + runId + kind it:
 *   1. POSTs /api/media/sign to mint a signed upload URL + token
 *   2. uploads the File with the ANON client's `uploadToSignedUrl(path, token,
 *      file)` — the service key never reaches the browser, only the short-lived
 *      token does
 *   3. POSTs /api/media/confirm so the server records the media_assets row
 *
 * MVP auth: the shared secret is prompted once and kept in sessionStorage under
 * 'mod_secret', matching ModerateRow. A stopgap until GitHub OAuth lands.
 */

const BUCKET = process.env.NEXT_PUBLIC_SUPABASE_MEDIA_BUCKET ?? 'ds-media';

type Phase = 'idle' | 'signing' | 'uploading' | 'confirming' | 'done' | 'error';

export interface MediaUploadProps {
  board: 'daily_gold_runs' | 'trial_runs';
  runId: string;
  /** gold runs take a 'screenshot', trial runs a 'video'. */
  kind: MediaKind;
}

export function MediaUpload({ board, runId, kind }: MediaUploadProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [msg, setMsg] = useState<string | null>(null);

  const accept = kind === 'screenshot' ? 'image/*' : 'video/*';

  async function upload(file: File) {
    const secret =
      window.sessionStorage.getItem('mod_secret') ?? window.prompt('Upload secret');
    if (!secret) return;
    window.sessionStorage.setItem('mod_secret', secret);

    setMsg(null);
    try {
      // 1. mint the signed upload URL.
      setPhase('signing');
      const signRes = await fetch('/api/media/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
        body: JSON.stringify({ board, runId, kind, filename: file.name }),
      });
      const signBody = (await signRes.json()) as {
        ok: boolean;
        reason?: string;
        token?: string;
        path?: string;
      };
      if (!signBody.ok || !signBody.token || !signBody.path) {
        if (signRes.status === 401) window.sessionStorage.removeItem('mod_secret');
        throw new Error(signBody.reason ?? 'could not mint upload URL');
      }

      // 2. upload directly to Storage with the anon client + the token. No
      //    service key in the browser — only this short-lived token.
      setPhase('uploading');
      const { error: uploadErr } = await browserClient()
        .storage.from(BUCKET)
        .uploadToSignedUrl(signBody.path, signBody.token, file);
      if (uploadErr) throw uploadErr;

      // 3. record the media_assets row.
      setPhase('confirming');
      const confirmRes = await fetch('/api/media/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
        body: JSON.stringify({ board, runId, kind, path: signBody.path, byteSize: file.size }),
      });
      const confirmBody = (await confirmRes.json()) as { ok: boolean; reason?: string };
      if (!confirmBody.ok) {
        if (confirmRes.status === 401) window.sessionStorage.removeItem('mod_secret');
        throw new Error(confirmBody.reason ?? 'could not record media');
      }

      setPhase('done');
    } catch (err) {
      setPhase('error');
      setMsg((err as Error).message);
    }
  }

  const busy = phase === 'signing' || phase === 'uploading' || phase === 'confirming';
  const label: Record<Phase, string> = {
    idle: kind === 'screenshot' ? 'add screenshot' : 'add video',
    signing: 'preparing…',
    uploading: 'uploading…',
    confirming: 'sealing…',
    done: 'uploaded',
    error: 'retry',
  };

  return (
    <span style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center' }}>
      <label className="btn" style={{ opacity: busy ? 0.6 : 1, cursor: busy ? 'wait' : 'pointer' }}>
        {label[phase]}
        <input
          type="file"
          accept={accept}
          disabled={busy}
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            // reset the input so picking the same file again re-fires onChange.
            e.target.value = '';
            if (file) void upload(file);
          }}
        />
      </label>
      {phase === 'done' ? <span className="badge">{kind} ⛁ stored</span> : null}
      {phase === 'error' && msg ? <span className="badge pending">{msg}</span> : null}
    </span>
  );
}
