/**
 * Database row shapes and Supabase clients.
 *
 * Two clients, never mixed:
 *  - `browserClient()` uses the anon key + RLS — safe for the browser/SSR reads.
 *  - `serviceClient()` uses the service-role key — SERVER ONLY (ingest, mod
 *    actions). It bypasses RLS, so it must never be imported into client code.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type VerificationStatus = 'pending' | 'approved' | 'rejected';
export type GoldSource = 'slay' | 'battle' | 'quest';
export type MediaKind = 'screenshot' | 'video';
export type GuildRole = 'owner' | 'mod' | 'member';

export interface PlayerRow {
  id: string;
  github_handle: string;
  github_id: number | null;
  created_at: string;
}

export interface GuildRow {
  id: string;
  slug: string;
  name: string;
  is_private: boolean;
  owner_id: string | null;
  created_at: string;
}

export interface GuildInviteRow {
  id: string;
  guild_id: string;
  token: string;
  email: string | null;
  expires_at: string | null;
  used_by: string | null;
}

export interface DailyGoldRunRow {
  id: string;
  player_id: string;
  guild_id: string | null;
  day: string;
  gold: number;
  game_version: string;
  repo_sigil: string;
  receipt_hash: string;
  receipt_url: string | null;
  status: VerificationStatus;
  submitted_at: string;
}

export interface TrialRunRow {
  id: string;
  player_id: string;
  guild_id: string | null;
  trial_id: string;
  duration_ms: number;
  keystrokes: number;
  par: number;
  stars: number;
  completed_at: string | null;
  game_version: string;
  receipt_hash: string;
  receipt_url: string | null;
  status: VerificationStatus;
  submitted_at: string;
}

export interface TrialRow {
  id: string;
  tier: number;
  title: string;
  par: number;
  game_version: string;
}

export interface MediaAssetRow {
  id: string;
  kind: MediaKind;
  storage_path: string;
  byte_size: number | null;
  daily_run_id: string | null;
  trial_run_id: string | null;
  uploaded_by: string | null;
  created_at: string;
}

/** A board row joined with its player handle — the shape the UI renders. */
export interface GoldBoardEntry extends DailyGoldRunRow {
  github_handle: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

/** Anon client (RLS-enforced). Safe in the browser and SSR read paths. */
export function browserClient(): SupabaseClient {
  return createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    { auth: { persistSession: false } },
  );
}

/**
 * Service-role client (bypasses RLS). SERVER ONLY — importing this into a
 * client component leaks the service key. Used by ingest + moderator routes.
 */
export function serviceClient(): SupabaseClient {
  return createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false } },
  );
}
