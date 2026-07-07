#!/usr/bin/env bash
# Create a single-file backup of the MAVERIC data server: the PostgreSQL
# database plus the assembled_files/ and ingested_jsonl/ directories.
#
# Usage: scripts/backup.sh [output.tar.gz]
# Honours the same PG_* env vars the server reads (server/db.ts) and
# MAVERIC_APP_DIR for the directory that holds the on-disk file folders.
set -euo pipefail

PG_HOST="${PG_HOST:-localhost}"
PG_PORT="${PG_PORT:-5432}"
PG_DATABASE="${PG_DATABASE:-maveric_gs}"
PG_USER="${PG_USER:-maveric}"
PG_PASSWORD="${PG_PASSWORD:-maveric}"

# The data server keeps assembled_files/ and ingested_jsonl/ under its cwd.
APP_DIR="${MAVERIC_APP_DIR:-$(pwd)}"

OUT="${1:-maveric-backup-$(date +%Y%m%d-%H%M%S).tar.gz}"
# Resolve OUT to an absolute path so the final message is unambiguous.
OUT_DIR="$(cd "$(dirname "$OUT")" && pwd)"
OUT="$OUT_DIR/$(basename "$OUT")"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

export PGPASSWORD="$PG_PASSWORD"
pg_dump -Fc -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DATABASE" \
  -f "$WORK/database.dump"

printf 'database=%s\ncreated=%s\n' \
  "$PG_DATABASE" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$WORK/MANIFEST"

# Only include file directories that actually exist.
DIRS=()
[ -d "$APP_DIR/assembled_files" ] && DIRS+=("assembled_files")
[ -d "$APP_DIR/ingested_jsonl" ] && DIRS+=("ingested_jsonl")

tar -czf "$OUT" -C "$WORK" database.dump MANIFEST \
  ${DIRS[@]:+-C "$APP_DIR" "${DIRS[@]}"}

echo "$OUT"
