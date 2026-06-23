-- Dragonslayer leaderboard — store the proof media URL on each run.
--
-- Submissions now REQUIRE media proof: a daily-gold run needs a screenshot/image,
-- a trial speedrun needs a video. The media is supplied as an external URL in the
-- submission PR (GitHub-hosted drag-drop / a pasted link) and passed through
-- /api/ingest. We keep that URL on the run row itself.
--
-- Why not media_assets? That table models files UPLOADED THROUGH THE APP to
-- Supabase Storage (its storage_path is a bucket key, and its RLS assumes that).
-- PR media is an external URL, a different source — overloading storage_path with
-- URLs would muddy that contract. So external proof lives here, app uploads stay
-- in media_assets. The run's table implies the kind (gold→image, trial→video).

alter table daily_gold_runs add column if not exists media_url text;
alter table trial_runs     add column if not exists media_url text;

comment on column daily_gold_runs.media_url is
  'External screenshot/image URL proving the haul (from the submission PR). Required at ingest.';
comment on column trial_runs.media_url is
  'External video URL proving the clear (from the submission PR). Required at ingest.';
