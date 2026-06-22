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

  return (
    <>
      <h1>Gold Earned in a Day</h1>
      <p className="empty" style={{ padding: '0.5rem 0' }}>
        The biggest single-day hauls — coverage reclaimed, dragons slain, quests
        cleared. Approved runs only; each backed by a screenshot.
      </p>

      {error ? (
        <p className="empty">{error}</p>
      ) : rows.length === 0 ? (
        <p className="empty">No approved hauls yet. Be the first to ride.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th className="rank">#</th>
              <th>Knight</th>
              <th>Gold</th>
              <th>Day</th>
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
                <td className="gold">⛁ {r.gold.toLocaleString()}</td>
                <td>{r.day}</td>
                <td>
                  {r.receiptUrl ? (
                    <a href={r.receiptUrl} target="_blank" rel="noreferrer">
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
      )}
    </>
  );
}
