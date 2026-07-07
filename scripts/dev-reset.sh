#!/usr/bin/env bash
# Drop the local database and replay migrations + seed.sql for a clean slate.
# Podman/Docker-aware via scripts/lib.sh. Requires the stack to be up (dev-up).
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

case "${1:-}" in
  -h|--help)
    cat <<'EOF'
Usage: ./scripts/dev-reset.sh

Runs `supabase db reset`: drops the local database, replays every migration in
supabase/migrations/, then loads supabase/seed.sql. Use it to get back to a
known-good seeded state.

The stack must already be running (./scripts/dev-up.sh). This does not touch the
storage/auth containers, only the database.
EOF
    exit 0 ;;
esac

info "Resetting the local database (migrations + seed.sql)..."
ensure_container_engine
run_supabase db reset
ok "Database reset and reseeded. The boards and moderator queue are repopulated."
