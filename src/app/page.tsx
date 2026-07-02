import { approvedGoldBoard, type GoldBoardRow } from '@/lib/boards';
import { browserClient } from '@/lib/db';

// Revalidate the board every 60s (ISR) — fresh enough, cheap on the free tier.
export const revalidate = 60;

async function loadBoard(): Promise<{ rows: GoldBoardRow[]; error: string | null }> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return { rows: [], error: 'Supabase is not configured yet — set env vars to see live runs.' };
  }
  try {
    return { rows: await approvedGoldBoard(browserClient(), { limit: 100 }), error: null };
  } catch (err) {
    return { rows: [], error: (err as Error).message };
  }
}

export default async function GoldBoardPage() {
  const { rows, error } = await loadBoard();
  const [champion, ...field] = rows;

  return (
    <>
      <p className="eyebrow">Gold earned in a day</p>
      <h1>The richest hauls in the realm</h1>
      <p className="lede">
        One day, all the gold a knight can mint — coverage reclaimed, dragons
        slain, quests cleared. Approved runs only; each backed by a screenshot.
      </p>

      {error ? (
        <p className="empty">{error}</p>
      ) : rows.length === 0 ? (
        <div className="empty">
          <p>No approved hauls yet. Be the first to ride.</p>
          <p className="cta">
            <a href="https://github.com/Soypete/ds-submissions#how-to-submit">
              Submit your run →{'\u2002'}
            </a>
          </p>
        </div>
      ) : (
        <>
          <section className="champion" aria-label="Current leader">
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
                {champion.day}
                {champion.receiptUrl ? (
                  <>
                    {' · '}
                    <a href={champion.receiptUrl} target="_blank" rel="noreferrer">
                      receipt
                    </a>
                  </>
                ) : null}
              </p>
            </div>
            <p className="champion-figure">
              <span className="amount tnum">⛁ {champion.gold.toLocaleString()}</span>
              <span className="unit">gold</span>
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
                    <th className="num">Gold</th>
                    <th>Day</th>
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
                      <td className="gold num">⛁ {r.gold.toLocaleString()}</td>
                      <td>{r.day}</td>
                      <td>
                        {r.receiptUrl ? (
                          <a
                            className="proof"
                            href={r.receiptUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            receipt
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
