#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ENV_FILE=${PRODUCTION_ENV_FILE:-$ROOT/.env.production}
COMPOSE_FILE=${PRODUCTION_COMPOSE_FILE:-$ROOT/compose.production.yaml}
PROJECT_NAME=${PRODUCTION_PROJECT_NAME:-deadlock-inside-release}

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 BACKUP.dump NEW_DATABASE_NAME" >&2
  exit 2
fi
archive=$1
target=$2
if [ ! -f "$archive" ] || [ ! -s "$archive" ]; then
  echo "Backup archive is missing or empty" >&2
  exit 2
fi
case "$target" in
  [a-z]*) ;;
  *) echo "Target database must start with a lowercase letter" >&2; exit 2 ;;
esac
case "$target" in
  *[!a-z0-9_]* | '') echo "Target database must use lowercase letters, digits, and underscores" >&2; exit 2 ;;
esac
if [ "${#target}" -gt 63 ]; then
  echo "Target database name must be at most 63 characters" >&2
  exit 2
fi
if [ ! -f "$ENV_FILE" ]; then
  echo "Production environment file not found: $ENV_FILE" >&2
  exit 2
fi
configured_db=$(sed -n 's/^POSTGRES_DB=//p' "$ENV_FILE" | tail -n 1)
configured_db=${configured_db:-deadlock}
configured_db=$(printf '%s' "$configured_db" | sed 's/^"//;s/"$//')
postgres_user=$(sed -n 's/^POSTGRES_USER=//p' "$ENV_FILE" | tail -n 1)
postgres_user=${postgres_user:-deadlock}
postgres_user=$(printf '%s' "$postgres_user" | sed 's/^"//;s/"$//')
if [ "$target" = "$configured_db" ]; then
  echo "Refusing to restore over the configured application database" >&2
  exit 2
fi

compose() {
  docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

exists=$(compose exec -T postgres psql --no-psqlrc -U "$postgres_user" -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname = '$target'")
if [ "$exists" = "1" ]; then
  echo "Target database already exists; refusing to overwrite it" >&2
  exit 2
fi
compose exec -T postgres psql --no-psqlrc -v ON_ERROR_STOP=1 -U "$postgres_user" -d postgres -c "CREATE DATABASE \"$target\"" >/dev/null
if ! compose exec -T postgres pg_restore --exit-on-error --single-transaction --no-owner --no-privileges -U "$postgres_user" -d "$target" < "$archive"; then
  echo "Restore failed; the newly created database $target is left for diagnosis" >&2
  exit 1
fi
counts=$(compose exec -T postgres psql --no-psqlrc -U "$postgres_user" -d "$target" -Atc "SELECT (SELECT count(*) FROM players)||':'||(SELECT count(*) FROM matches)||':'||(SELECT count(*) FROM match_players)")
sample=$(compose exec -T postgres psql --no-psqlrc -U "$postgres_user" -d "$target" -Atc "SELECT account_id::text FROM players ORDER BY account_id LIMIT 1")
printf 'Restored into %s; players:matches:match_players=%s; representative account_id=%s\n' "$target" "$counts" "${sample:-none}"
