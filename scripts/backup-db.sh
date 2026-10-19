#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
ENV_FILE=${PRODUCTION_ENV_FILE:-$ROOT/.env.production}
COMPOSE_FILE=${PRODUCTION_COMPOSE_FILE:-$ROOT/compose.production.yaml}
PROJECT_NAME=${PRODUCTION_PROJECT_NAME:-deadlock-inside-release}
BACKUP_DIR=$ROOT/.backups

if [ ! -f "$ENV_FILE" ]; then
  echo "Production environment file not found: $ENV_FILE" >&2
  exit 2
fi
mkdir -p "$BACKUP_DIR"
physical_backup_dir=$(CDPATH= cd -- "$BACKUP_DIR" && pwd -P)
if [ "$physical_backup_dir" != "$BACKUP_DIR" ]; then
  echo "Backup directory must resolve to the repository's .backups directory" >&2
  exit 2
fi
chmod 700 "$BACKUP_DIR"
tmp=$(mktemp "$BACKUP_DIR/.deadlock-XXXXXX")
trap 'rm -f "$tmp"' EXIT HUP INT TERM

compose() {
  docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

stamp=$(date -u +%Y%m%dT%H%M%SZ)
archive="$BACKUP_DIR/deadlock-$stamp.dump"
compose exec -T postgres pg_dump --format=custom > "$tmp"
test -s "$tmp" || { echo "pg_dump produced an empty archive" >&2; exit 1; }
mv "$tmp" "$archive"
chmod 600 "$archive"
for old_archive in "$BACKUP_DIR"/deadlock-*.dump; do
  [ -f "$old_archive" ] || continue
  find "$old_archive" -mtime +6 -exec rm -f -- {} \;
done
printf '%s\n' "$archive"
