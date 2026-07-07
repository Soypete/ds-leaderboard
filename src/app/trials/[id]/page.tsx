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

/** Keystrokes vs par as a signed delta, e.g. "−3 under par" / "even with par". */
function parDelta(keys: number, par: number): string {
  const d = keys - par;
  if (d === 0) return 'even with par';
  if (d < 0) return `${Math.abs(d)} under par`;
  return `${d} over par`;
}

export default async function TrialBoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { trial, rows, error } = await loadBoard(id);
  const title = trial?.title ?? id;
  const [champion, ...field] = rows;

  return (
    <>
      <Link className="back-link" href="/trials">
        ← all trials
      </Link>
      <p className="eyebrow">
        {trial ? `Tier ${trial.tier} · par ${trial.par} keys` : 'Trial speedrun'}
      </p>
      <h1>{title}</h1>
      <p className="lede">
        The cleanest, fastest clears of this trial — fewest keystrokes break a tie on
        the clock. Each backed by a video.
      </p>

      {error ? (
        <p className="empty">{error}</p>
      ) : rows.length === 0 ? (
        <p className="empty">No approved clears yet. Be the first to draw steel.</p>
      ) : (
        <>
          <section className="champion" aria-label="Fastest clear">
            <span className="champion-rank" aria-hidden="true">
              1
            </span>
            <div>
              <a
                className="champion-name"
                href={`https://github.com/${champion.handle}`}
                target="_blank"
                rel="noreferrer"
              >
                {champion.handle}
              </a>
              <p className="champion-meta">
                <span className="stars">{stars(champion.stars)}</span>
                {champion.receiptUrl ? (
                  <>
                    {' · '}
                    <a href={champion.receiptUrl} target="_blank" rel="noreferrer">
                      video
                    </a>
                  </>
                ) : null}
              </p>
            </div>
            <p className="champion-figure">
              <span className="amount time tnum">{formatTime(champion.durationMs)}</span>
              <span className="delta tnum">
                {champion.keystrokes} keys · {parDelta(champion.keystrokes, champion.par)}
              </span>
            </p>
          </section>

          {field.length > 0 && (
            <>
              <p className="field-rule">The field</p>
              <table>
                <thead>
                  <tr>
                    <th className="rank">#</th>
                    <th>Knight</th>
                    <th className="num">Time</th>
                    <th className="num">Keys</th>
                    <th className="num">Par</th>
                    <th>Stars</th>
                    <th>Proof</th>
                  </tr>
                </thead>
                <tbody>
                  {field.map((r, i) => (
                    <tr key={r.runId}>
                      <td className="rank">{i + 2}</td>
                      <td>
                        <a
                          className="handle"
                          href={`https://github.com/${r.handle}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {r.handle}
                        </a>
                      </td>
                      <td className="gold num">{formatTime(r.durationMs)}</td>
                      <td className="num">{r.keystrokes}</td>
                      <td className="num">{r.par}</td>
                      <td className="stars">{stars(r.stars)}</td>
                      <td>
                        {r.receiptUrl ? (
                          <a className="proof" href={r.receiptUrl} target="_blank" rel="noreferrer">
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
            </>
          )}
        </>
      )}
    </>
  );
}
