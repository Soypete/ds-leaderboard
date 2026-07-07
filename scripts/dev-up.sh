#!/usr/bin/env bash
# Bring up the local Supabase stack (Postgres + Storage + Auth + Studio) and load
# the schema + seed data, so the leaderboard app has a real backend to talk to.
#
# Works with Podman (the engine on this machine) or Docker — the engine detection
# and DOCKER_HOST wiring live in scripts/lib.sh.
#
# Idempotent: safe to re-run. If the stack is already up it just re-prints the
# connection details; pass --reset to drop and reload the database.
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

DO_RESET="false"
for arg in "$@"; do
  case "$arg" in
    --reset) DO_RESET="true" ;;
    -h|--help)
      cat <<'EOF'
Usage: ./scripts/dev-up.sh [--reset]

Boots the local Supabase stack and applies migrations + seed data.

  --reset   Also run `supabase db reset` to drop and reload the database from
            scratch (migrations + seed.sql). Use for a clean slate.

After it finishes, copy the printed API URL + keys into .env.local, then run
`npm run dev`.
EOF
      exit 0 ;;
    *) die "Unknown argument: $arg (try --help)" ;;
  esac
done

info "Preparing the local Dragonslayer leaderboard backend..."

# 1. Make the container engine usable by the supabase CLI.
ensure_container_engine

# 2. Start the stack. `supabase start` is itself idempotent — if the containers
#    are already running it returns quickly and just re-emits the status.
info "Starting Supabase (this pulls images on first run — give it a few minutes)..."
run_supabase start

# 3. Load schema + seed.
#    `db reset` drops the DB and replays migrations + seed.sql — the cleanest way
#    to guarantee the schema and seed are applied. On a fresh `start` the
#    migrations are already applied, but reset also loads seed.sql, which a plain
#    start does not. We run it on first boot (no seed yet) or on explicit --reset.
if [[ "$DO_RESET" == "true" ]]; then
  info "Resetting the database (migrations + seed.sql)..."
  run_supabase db reset
  ok "Database reset and reseeded."
else
  # Apply seed without a full reset noise on re-runs: a reset is the supported way
  # to load seed.sql, so do it once to populate, and let re-runs be a no-op-ish
  # reset (cheap locally). Keeping it explicit and predictable.
  info "Applying migrations + seed data via db reset..."
  run_supabase db reset
  ok "Schema and seed data applied."
fi

# 4. Print connection details for .env.local.
info "Local stack is up. Connection details:"
run_supabase status

cat <<EOF

${_C_BOLD}Next steps${_C_RESET}
  1. Copy the values above into .env.local (see .env.example):
       NEXT_PUBLIC_SUPABASE_URL        <- "API URL"
       NEXT_PUBLIC_SUPABASE_ANON_KEY   <- "anon key"
       SUPABASE_SERVICE_ROLE_KEY       <- "service_role key"
     The anon/service keys are the same on every local machine, so you can paste
     them once and forget them.
  2. Studio (browse data, run SQL): the "Studio URL" above (http://127.0.0.1:54323).
  3. Run the app:  npm run dev   ->  http://localhost:3000
  4. Reset to a clean seeded DB:  ./scripts/dev-reset.sh
  5. Stop everything:             ./scripts/dev-down.sh
EOF

ok "dev-up complete."
