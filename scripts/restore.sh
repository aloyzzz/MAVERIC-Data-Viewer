#!/usr/bin/env bash
# Restore a backup produced by scripts/backup.sh: reload the PostgreSQL
# database and replace the assembled_files/ and ingested_jsonl/ directories.
#
# Usage: scripts/restore.sh <backup.tar.gz>
# Honours the same PG_* env vars the server reads (server/db.ts) and
# MAVERIC_APP_DIR for the directory that holds the on-disk file folders.
#
# WARNING: this drops and recreates the objects in the target database.
# Stop the data server (or expect it to reconnect) before restoring.
set -euo pipefail

ARCHIVE="${1:?usage: restore.sh <backup.tar.gz>}"
[ -f "$ARCHIVE" ] || { echo "Archive not found: $ARCHIVE" >&2; exit 1; }
ARCHIVE="$(cd "$(dirname "$ARCHIVE")" && pwd)/$(basename "$ARCHIVE")"

PG_HOST="${PG_HOST:-localhost}"
PG_PORT="${PG_PORT:-5432}"
PG_DATABASE="${PG_DATABASE:-maveric_gs}"
PG_USER="${PG_USER:-maveric}"
PG_PASSWORD="${PG_PASSWORD:-maveric}"
APP_DIR="${MAVERIC_APP_DIR:-$(pwd)}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

tar -xzf "$ARCHIVE" -C "$WORK"
[ -f "$WORK/database.dump" ] || { echo "database.dump missing from archive" >&2; exit 1; }

export PGPASSWORD="$PG_PASSWORD"
pg_restore --clean --if-exists --no-owner \
  -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DATABASE" \
  "$WORK/database.dump"

# Replace the on-disk file directories in place.
for d in assembled_files ingested_jsonl; do
  if [ -d "$WORK/$d" ]; then
    rm -rf "${APP_DIR:?}/$d"
    mkdir -p "$APP_DIR"
    cp -R "$WORK/$d" "$APP_DIR/$d"
  fi
done

echo "Restore complete into database '$PG_DATABASE' and $APP_DIR"
