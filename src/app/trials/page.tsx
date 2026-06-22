import Link from 'next/link';

import { browserClient, type TrialRow } from '@/lib/db';
import { listTrials } from '@/lib/trial-boards';

// Revalidate the catalog every 5 min (ISR) — it only changes when a sync runs.
export const revalidate = 300;

async function loadTrials(): Promise<{ rows: TrialRow[]; error: string | null }> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return { rows: [], error: 'Supabase is not configured yet — set env vars to see the trial roster.' };
  }
  try {
    return { rows: await listTrials(browserClient()), error: null };
  } catch (err) {
    return { rows: [], error: (err as Error).message };
  }
}

/** Group the flat catalog into tiers, preserving the catalog's order. */
function byTier(rows: TrialRow[]): { tier: number; trials: TrialRow[] }[] {
  const groups = new Map<number, TrialRow[]>();
  for (const r of rows) {
    const list = groups.get(r.tier) ?? [];
    list.push(r);
    groups.set(r.tier, list);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([tier, trials]) => ({ tier, trials }));
}

export default async function TrialsIndexPage() {
  const { rows, error } = await loadTrials();
  const tiers = byTier(rows);

  return (
    <>
      <h1>Vim Trial Speedruns</h1>
      <p className="empty" style={{ padding: '0.5rem 0' }}>
        One board per trial — fastest blade first, ranked by time then keystrokes.
        Pick a trial to see who cleared it cleanest. Approved runs only; each
        backed by a video.
      </p>

      {error ? (
        <p className="empty">{error}</p>
      ) : tiers.length === 0 ? (
        <p className="empty">No trials in the catalog yet. Sync the realm to raise the boards.</p>
      ) : (
        tiers.map(({ tier, trials }) => (
          <section key={tier}>
            <h2 style={{ color: 'var(--banner)' }}>Tier {tier}</h2>
            <table>
              <thead>
                <tr>
                  <th>Trial</th>
                  <th>Par</th>
                </tr>
              </thead>
              <tbody>
                {trials.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <Link href={`/trials/${encodeURIComponent(t.id)}`}>{t.title}</Link>
                    </td>
                    <td>{t.par} keys</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))
      )}
    </>
  );
}
