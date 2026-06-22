#!/usr/bin/env bash
# Shared helpers for the dev-*.sh scripts.
#
# This file is meant to be *sourced*, not executed directly:
#
#     source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
#
# Its one job is to make `npx supabase` work whether the local container engine is
# real Docker or Podman. The Supabase CLI drives Docker-compatible containers and
# talks to the daemon over DOCKER_HOST; Podman exposes a Docker-compatible socket
# but doesn't set DOCKER_HOST for you, so we resolve and export it here.

# --- output helpers ----------------------------------------------------------
# Colour only when stdout is a terminal, so log files / CI stay clean.
if [[ -t 1 ]]; then
  _C_RESET=$'\033[0m'; _C_BOLD=$'\033[1m'
  _C_BLUE=$'\033[34m'; _C_GREEN=$'\033[32m'; _C_YELLOW=$'\033[33m'; _C_RED=$'\033[31m'
else
  _C_RESET=""; _C_BOLD=""; _C_BLUE=""; _C_GREEN=""; _C_YELLOW=""; _C_RED=""
fi

info()  { printf '%s\n' "${_C_BLUE}==>${_C_RESET} ${_C_BOLD}$*${_C_RESET}"; }
ok()    { printf '%s\n' "${_C_GREEN}  ✓${_C_RESET} $*"; }
warn()  { printf '%s\n' "${_C_YELLOW}  !${_C_RESET} $*" >&2; }
err()   { printf '%s\n' "${_C_RED}  ✗ $*${_C_RESET}" >&2; }
die()   { err "$*"; exit 1; }

# Repo root = the directory that contains this scripts/ dir.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# The supabase CLI — pinned, run via npx so no global install is required.
SUPABASE_VERSION="2.107.0"
supabase() { npx --yes "supabase@${SUPABASE_VERSION}" "$@"; }

# --- container engine detection ----------------------------------------------
# Sets and exports DOCKER_HOST when Podman is the engine, and verifies the daemon
# is actually reachable. Exits non-zero with an actionable message otherwise.
#
# Detection order:
#   1. If `docker` exists and is *real* Docker -> use it as-is.
#   2. Else if Podman is available (either a real `podman`, or `docker` that is a
#      Podman shim) -> ensure the machine is up, resolve the socket, export
#      DOCKER_HOST.
#   3. Else -> fail with instructions.
ensure_container_engine() {
  # Respect an already-set DOCKER_HOST (advanced users / CI overrides).
  if [[ -n "${DOCKER_HOST:-}" ]]; then
    info "Using DOCKER_HOST from environment: ${DOCKER_HOST}"
    _verify_daemon || die "DOCKER_HOST is set but the daemon there is unreachable."
    return 0
  fi

  local docker_is_podman="false"
  if command -v docker >/dev/null 2>&1; then
    if docker --version 2>/dev/null | grep -qi podman; then
      docker_is_podman="true"
    fi
  fi

  # Case 1: real Docker.
  if command -v docker >/dev/null 2>&1 && [[ "$docker_is_podman" == "false" ]]; then
    info "Detected Docker."
    _verify_daemon && { ok "Docker daemon is reachable."; return 0; }
    die "Docker is installed but the daemon isn't reachable. Is Docker Desktop running?"
  fi

  # Case 2: Podman (real binary or docker shim).
  if command -v podman >/dev/null 2>&1 || [[ "$docker_is_podman" == "true" ]]; then
    info "Detected Podman (Docker-compatible mode)."
    _ensure_podman_machine
    _export_podman_docker_host
    _verify_daemon && { ok "Podman daemon is reachable at ${DOCKER_HOST}."; return 0; }
    die "Podman socket exported but the daemon isn't responding. Try: podman machine restart"
  fi

  die "No container engine found. Install Podman (https://podman.io) or Docker, then re-run."
}

# Make sure a podman machine exists and is running (macOS / Windows need a VM).
_ensure_podman_machine() {
  # `podman machine` only applies where a VM is used; on native Linux it's a no-op.
  if ! podman machine list --format '{{.Name}}' >/dev/null 2>&1; then
    return 0  # native podman, no machine concept
  fi

  local machines
  machines="$(podman machine list --format '{{.Name}} {{.Running}}' 2>/dev/null || true)"

  if [[ -z "$machines" ]]; then
    warn "No podman machine exists. Creating the default one (this can take a minute)..."
    podman machine init || die "Failed to create a podman machine."
    podman machine start || die "Failed to start the podman machine."
    ok "Podman machine created and started."
    return 0
  fi

  if printf '%s\n' "$machines" | grep -qiE 'true$'; then
    ok "Podman machine is running."
    return 0
  fi

  info "Podman machine is not running. Starting it..."
  podman machine start || die "Failed to start the podman machine. Try: podman machine start"
  ok "Podman machine started."
}

# Resolve the podman API socket and export DOCKER_HOST=unix://<socket>.
_export_podman_docker_host() {
  local socket=""

  # Preferred: ask the running machine for its Docker-compatible socket path.
  socket="$(podman machine inspect --format '{{.ConnectionInfo.PodmanSocket.Path}}' 2>/dev/null || true)"

  # Fallback: parse the default connection's URI (already a unix:// URL).
  if [[ -z "$socket" ]]; then
    local uri
    uri="$(podman system connection list --format '{{.URI}}' 2>/dev/null | head -n1 || true)"
    if [[ "$uri" == unix://* ]]; then
      export DOCKER_HOST="$uri"
      return 0
    fi
    socket="${uri#unix://}"
  fi

  [[ -n "$socket" ]] || die "Could not resolve the podman socket path. Is the machine running?"
  export DOCKER_HOST="unix://${socket}"
}

# Cheap liveness probe against the active engine.
_verify_daemon() {
  # `docker info` returns non-zero if the daemon is unreachable; we don't care
  # about its (engine-specific) output, only the exit status.
  if command -v docker >/dev/null 2>&1; then
    docker info >/dev/null 2>&1 && return 0
  fi
  if command -v podman >/dev/null 2>&1; then
    podman info >/dev/null 2>&1 && return 0
  fi
  return 1
}

# Run the supabase CLI from the repo root so it finds supabase/config.toml.
run_supabase() { ( cd "$REPO_ROOT" && supabase "$@" ); }
