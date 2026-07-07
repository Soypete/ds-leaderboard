import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Read a server-side env var for the tests, falling back to .env.local (the
 * same file `next dev` loads) so `npm run test:e2e` works without exporting
 * anything by hand.
 */
export function serverEnv(name: string): string {
  if (process.env[name]) return process.env[name] as string;
  try {
    const raw = readFileSync(join(process.cwd(), '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && m[1] === name) return m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    // fall through
  }
  throw new Error(`${name} not set and not found in .env.local — is the local stack configured?`);
}
