import Link from 'next/link';

import { browserClient, type TrialRow } from '@/lib/db';
import { approvedTrialBoard, getTrial, type TrialBoardRow } from '@/lib/trial-boards';

// Revalidate each trial board every 60s (ISR) — matches the gold board cadence.
export const revalidate = 60;

interface BoardData {
  trial: TrialRow | null;
  rows: TrialBoardRow[];
  error: string | null;
}

async function loadBoard(trialId: string): Promise<BoardData> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return {
      trial: null,
      rows: [],
      error: 'Supabase is not configured yet — set env vars to see live runs.',
    };
  }
  try {
    const db = browserClient();
    const [trial, rows] = await Promise.all([
      getTrial(db, trialId),
      approvedTrialBoard(db, trialId, { limit: 100 }),
    ]);
    return { trial, rows, error: null };
  } catch (err) {
    return { trial: null, rows: [], error: (err as Error).message };
  }
}

/** Render a duration in ms as a tidy "m:ss.mmm" / "s.mmm" time. */
function formatTime(ms: number): string {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  if (minutes > 0) {
    return `${minutes}:${seconds.toFixed(3).padStart(6, '0')}`;
  }
  return `${seconds.toFixed(3)}s`;
}

/** Star rating as filled/empty pips out of three. */
function stars(n: number): string {
  const filled = Math.max(0, Math.min(3, n));
  return '★'.repeat(filled) + '☆'.repeat(3 - filled);
}

export default async function TrialBoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { trial, rows, error } = await loadBoard(id);
  const title = trial?.title ?? id;

  return (
    <>
      <p style={{ marginBottom: '0.25rem' }}>
        <Link href="/trials">← All trials</Link>
      </p>
      <h1>{title}</h1>
      <p className="empty" style={{ padding: '0.5rem 0' }}>
        {trial ? (
          <>
            Tier {trial.tier} · par {trial.par} keys. The cleanest, fastest clears
            of this trial — each backed by a video.
          </>
        ) : (
          <>The cleanest, fastest clears of this trial — each backed by a video.</>
        )}
      </p>

      {error ? (
        <p className="empty">{error}</p>
      ) : rows.length === 0 ? (
        <p className="empty">No approved clears yet. Be the first to draw steel.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th className="rank">#</th>
              <th>Knight</th>
              <th>Time</th>
              <th>Keys</th>
              <th>Par</th>
              <th>Stars</th>
              <th>Proof</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.runId}>
                <td className="rank">{i + 1}</td>
                <td>
                  <a href={`https://github.com/${r.handle}`} target="_blank" rel="noreferrer">
                    {r.handle}
                  </a>
                </td>
                <td className="gold">{formatTime(r.durationMs)}</td>
                <td>{r.keystrokes}</td>
                <td>{r.par}</td>
                <td>{stars(r.stars)}</td>
                <td>
                  {r.receiptUrl ? (
                    <a href={r.receiptUrl} target="_blank" rel="noreferrer">
                      video
                    </a>
                  ) : (
                    <span className="badge">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
