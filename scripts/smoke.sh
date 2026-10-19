#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
WEB_PORT=${SMOKE_WEB_PORT:-8081}
export WEB_PORT
BASE_URL=${SMOKE_BASE_URL:-http://127.0.0.1:$WEB_PORT}
COMPOSE_FILE=${PRODUCTION_COMPOSE_FILE:-$ROOT/compose.production.yaml}
ENV_FILE=${PRODUCTION_ENV_FILE:-$ROOT/.env.production}
PROJECT_NAME=deadlock-inside-smoke

if [ "${SMOKE_FIXTURE:-}" != 1 ]; then
  echo "Set SMOKE_FIXTURE=1 to run the controlled synthetic profile scenario" >&2
  exit 2
fi
if [ "${SMOKE_PROJECT_NAME:-$PROJECT_NAME}" != "$PROJECT_NAME" ]; then
  echo "Synthetic smoke uses the dedicated Compose project deadlock-inside-smoke" >&2
  exit 2
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "Production environment file not found: $ENV_FILE" >&2
  exit 2
fi
compose() {
  docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" -f "$ROOT/compose.fixture.yaml" "$@"
}
compose build fixture
compose up --no-build -d --wait --wait-timeout 240
api_health=$(compose exec -T api python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/health/ready', timeout=8).read().decode())")
printf 'API ready: %s\n' "$api_health"
curl --fail --silent --show-error "$BASE_URL/" >/dev/null
heroes=$(curl --fail --silent --show-error "$BASE_URL/api/v1/heroes")
printf '%s' "$heroes" | jq -e '.data | length > 0' >/dev/null
echo "Web root and hero catalog responded"

search=$(curl --fail --silent --show-error --get --data-urlencode 'q=Smoke Fixture Player' "$BASE_URL/api/v1/players/search")
account_id=$(printf '%s' "$search" | jq -er '.data[0].account_id')
refresh=$(curl --fail --silent --show-error -X POST "$BASE_URL/api/v1/players/$account_id/refresh")
job_id=$(printf '%s' "$refresh" | jq -er '.data.job_id')
status=queued
attempt=0
while [ "$attempt" -lt 90 ]; do
  job=$(curl --fail --silent --show-error "$BASE_URL/api/v1/refresh-jobs/$job_id")
  status=$(printf '%s' "$job" | jq -er '.data.status')
  case "$status" in
    succeeded) break ;;
    failed) printf 'Profile refresh failed: %s\n' "$job" >&2; exit 1 ;;
  esac
  attempt=$((attempt + 1))
  sleep 2
done
if [ "$status" != succeeded ]; then
  echo "Timed out waiting for controlled profile refresh" >&2
  exit 1
fi
profile=$(curl --fail --silent --show-error "$BASE_URL/api/v1/players/$account_id")
history=$(curl --fail --silent --show-error "$BASE_URL/api/v1/players/$account_id/matches")
match_id=$(printf '%s' "$history" | jq -er '.data[0].match_id')
match=$(curl --fail --silent --show-error "$BASE_URL/api/v1/matches/$match_id")
match_job_id=$(printf '%s' "$match" | jq -r '.data.job_id // empty')
if [ -n "$match_job_id" ]; then
  status=queued
  attempt=0
  while [ "$attempt" -lt 90 ]; do
    job=$(curl --fail --silent --show-error "$BASE_URL/api/v1/refresh-jobs/$match_job_id")
    status=$(printf '%s' "$job" | jq -er '.data.status')
    case "$status" in
      succeeded) break ;;
      failed) printf 'Match refresh failed: %s\n' "$job" >&2; exit 1 ;;
    esac
    attempt=$((attempt + 1))
    sleep 2
  done
  if [ "$status" != succeeded ]; then
    echo "Timed out waiting for controlled match refresh" >&2
    exit 1
  fi
  match=$(curl --fail --silent --show-error "$BASE_URL/api/v1/matches/$match_id")
fi
printf '%s' "$profile" | jq -e '.data.account_id == "21001"' >/dev/null
printf '%s' "$match" | jq -e '.data.match_id == "290001" and (.data.players | length > 0)' >/dev/null
echo "Controlled search → profile → match passed (synthetic account 21001, match 290001)"
