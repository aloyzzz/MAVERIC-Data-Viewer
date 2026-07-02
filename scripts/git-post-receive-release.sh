#!/usr/bin/env bash
set -euo pipefail

BRANCH="${MAVERIC_RELEASE_BRANCH:-release}"
RELEASE_REF="refs/heads/${BRANCH}"
APP_DIR="${MAVERIC_APP_DIR:-/opt/maveric/app}"
LOG_FILE="${MAVERIC_DEPLOY_LOG:-/opt/maveric/logs/deploy.log}"
LOCK_FILE="${MAVERIC_DEPLOY_LOCK:-/tmp/maveric-release-deploy.lock}"
GIT_DIR_PATH="${MAVERIC_GIT_DIR:-$(git rev-parse --absolute-git-dir 2>/dev/null || pwd)}"
USE_SUDO="${MAVERIC_DEPLOY_USE_SUDO:-1}"

if [ "$USE_SUDO" != "0" ] && [ "${EUID:-$(id -u)}" -ne 0 ] && [ "${MAVERIC_DEPLOY_SUDO_ACTIVE:-0}" != "1" ]; then
  exec sudo -E env MAVERIC_DEPLOY_SUDO_ACTIVE=1 bash "$0" "$@"
fi

deploy_newrev=""
while read -r oldrev newrev refname; do
  if [ "$refname" = "$RELEASE_REF" ]; then
    deploy_newrev="$newrev"
    printf 'Release deploy requested: %s -> %s\n' "$oldrev" "$newrev"
  fi
done

if [ -z "$deploy_newrev" ]; then
  exit 0
fi

mkdir -p "$(dirname "$LOG_FILE")" "$APP_DIR"

(
  flock -n 9 || {
    printf '%s Deploy already running\n' "$(date -Is)" >> "$LOG_FILE"
    exit 1
  }

  {
    printf '\n---- MAVERIC release deploy started %s ----\n' "$(date -Is)"
    printf 'Branch: %s\n' "$BRANCH"
    printf 'Revision: %s\n' "$deploy_newrev"
    printf 'Git dir: %s\n' "$GIT_DIR_PATH"
    printf 'App dir: %s\n' "$APP_DIR"

    if [ ! -d "$APP_DIR/.git" ]; then
      if [ -n "$(find "$APP_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
        printf 'App dir exists but is not a Git checkout; refusing to overwrite: %s\n' "$APP_DIR" >&2
        exit 1
      fi
      git clone --branch "$BRANCH" "$GIT_DIR_PATH" "$APP_DIR"
    else
      git -C "$APP_DIR" fetch origin "$BRANCH"
      git -C "$APP_DIR" checkout "$BRANCH"
      git -C "$APP_DIR" reset --hard "origin/${BRANCH}"
    fi

    MAVERIC_DEPLOY_SKIP_CHECKOUT=1 "$APP_DIR/scripts/release-deploy.sh"
    printf '---- MAVERIC release deploy finished %s ----\n' "$(date -Is)"
  } >> "$LOG_FILE" 2>&1
) 9>"$LOCK_FILE"
