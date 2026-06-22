import { pendingGoldRuns, type GoldBoardRow } from '@/lib/boards';
import { serviceClient } from '@/lib/db';
import { ModerateRow } from './ModerateRow';

// Always fresh — moderators act on the live queue.
export const dynamic = 'force-dynamic';

async function loadQueue(): Promise<{ rows: GoldBoardRow[]; error: string | null }> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { rows: [], error: 'Service role key not configured — set SUPABASE_SERVICE_ROLE_KEY.' };
  }
  try {
    return { rows: await pendingGoldRuns(serviceClient()), error: null };
  } catch (err) {
    return { rows: [], error: (err as Error).message };
  }
}

export default async function ModeratorQueue() {
  const { rows, error } = await loadQueue();

  return (
    <>
      <h1>Moderator Queue — Gold Hauls</h1>
      <p className="empty" style={{ padding: '0.5rem 0' }}>
        Pending day-haul runs awaiting good-faith review. Approval requires a
        screenshot. Rejections need a note.
      </p>

      {error ? (
        <p className="empty">{error}</p>
      ) : rows.length === 0 ? (
        <p className="empty">The queue is clear. Well held.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Knight</th>
              <th>Gold</th>
              <th>Day</th>
              <th>Receipt</th>
              <th>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <ModerateRow key={r.runId} row={r} />
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
