#!/usr/bin/env bash
set -euo pipefail

BRANCH="${MAVERIC_RELEASE_BRANCH:-release}"
ROLE="${MAVERIC_DEPLOY_ROLE:-all}"
APP_DIR="${MAVERIC_APP_DIR:-$(pwd)}"
SKIP_CHECKOUT="${MAVERIC_DEPLOY_SKIP_CHECKOUT:-0}"
RUN_SMOKE="${MAVERIC_RUN_SMOKE:-0}"
USE_SUDO="${MAVERIC_DEPLOY_USE_SUDO:-1}"
LOG_PREFIX="[release-deploy]"

if [ "$USE_SUDO" != "0" ] && [ "${EUID:-$(id -u)}" -ne 0 ] && [ "${MAVERIC_DEPLOY_SUDO_ACTIVE:-0}" != "1" ]; then
  exec sudo -E env MAVERIC_DEPLOY_SUDO_ACTIVE=1 bash "$0" "$@"
fi

log() {
  printf '%s %s %s\n' "$LOG_PREFIX" "$(date -Is)" "$*"
}

run_restart() {
  local label="$1"
  local command="$2"
  if [ -z "$command" ]; then
    log "No restart command configured for ${label}; build completed without restart"
    return
  fi
  log "Restarting ${label}"
  bash -lc "$command"
}

case "$ROLE" in
  all|data|web) ;;
  *)
    echo "MAVERIC_DEPLOY_ROLE must be one of: all, data, web" >&2
    exit 2
    ;;
esac

cd "$APP_DIR"

if [ "$SKIP_CHECKOUT" != "1" ]; then
  log "Checking out origin/${BRANCH}"
  git fetch origin "$BRANCH"
  git checkout "$BRANCH"
  git reset --hard "origin/${BRANCH}"
fi

log "Installing dependencies"
npm ci

log "Verifying TypeScript"
npm run verify

if [ "$ROLE" = "all" ] || [ "$ROLE" = "web" ]; then
  log "Building web UI"
  npm run build:web
fi

if [ "$ROLE" = "all" ] || [ "$ROLE" = "data" ]; then
  log "Verifying server"
  npm run build:server
  if [ "$RUN_SMOKE" = "1" ]; then
    log "Running satellite values smoke test"
    npm run smoke:values
  fi
fi

if [ "$ROLE" = "all" ] || [ "$ROLE" = "data" ]; then
  run_restart "data server" "${MAVERIC_DATA_RESTART_CMD:-}"
fi

if [ "$ROLE" = "all" ] || [ "$ROLE" = "web" ]; then
  run_restart "web server" "${MAVERIC_WEB_RESTART_CMD:-}"
fi

log "Deployment complete for ${BRANCH} (${ROLE})"
