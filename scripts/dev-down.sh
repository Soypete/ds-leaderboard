#!/usr/bin/env bash
# Stop the local Supabase stack. Podman/Docker-aware via scripts/lib.sh.
#
# By default the database volume is preserved, so `dev-up` brings the same data
# back. Pass --no-backup to discard the local database volume on stop.
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

EXTRA_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --no-backup) EXTRA_ARGS+=(--no-backup) ;;
    -h|--help)
      cat <<'EOF'
Usage: ./scripts/dev-down.sh [--no-backup]

Stops the local Supabase containers.

  --no-backup   Also discard the local database volume (next dev-up starts empty
                and reseeds). Without it, your local data persists across stops.
EOF
      exit 0 ;;
    *) die "Unknown argument: $arg (try --help)" ;;
  esac
done

info "Stopping the local Supabase stack..."
ensure_container_engine
# Expand the optional-args array in a bash-3.2-safe way (macOS default bash trips
# on "${arr[@]}" for an empty array under `set -u`).
run_supabase stop ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}
ok "Stack stopped."
