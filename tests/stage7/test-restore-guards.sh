#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$root"
test -f scripts/restore-db.sh || { echo "restore script is missing" >&2; exit 1; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
printf 'fixture archive placeholder' > "$tmp/backup.dump"
cat > "$tmp/production.env" <<'EOF'
POSTGRES_USER=deadlock
POSTGRES_DB=deadlock
POSTGRES_PASSWORD=fixture-only
EOF

for target in deadlock bad-name 1bad; do
  if output=$(PRODUCTION_ENV_FILE="$tmp/production.env" sh scripts/restore-db.sh "$tmp/backup.dump" "$target" 2>&1); then
    echo "unsafe restore target accepted: $target" >&2
    exit 1
  fi
  case "$target:$output" in
    deadlock:*configured\ application\ database*) ;;
    bad-name:*lowercase\ letters*) ;;
    1bad:*start\ with\ a\ lowercase\ letter*) ;;
    *) echo "restore guard failed for the wrong reason: $target: $output" >&2; exit 1 ;;
  esac
done

if output=$(env -u SMOKE_FIXTURE sh scripts/smoke.sh 2>&1); then
  echo "synthetic smoke ran without its explicit opt-in" >&2
  exit 1
fi
case "$output" in
  *"Set SMOKE_FIXTURE=1"*) ;;
  *) echo "smoke refused for the wrong reason: $output" >&2; exit 1 ;;
esac

if output=$(SMOKE_FIXTURE=1 SMOKE_PROJECT_NAME=deadlock-inside-release sh scripts/smoke.sh 2>&1); then
  echo "synthetic smoke accepted the production Compose project" >&2
  exit 1
fi
case "$output" in
  *"dedicated Compose project deadlock-inside-smoke"*) ;;
  *) echo "smoke refused the production project for the wrong reason: $output" >&2; exit 1 ;;
esac

echo "restore guards rejected the configured database, unsafe identifiers, smoke without opt-in, and production project reuse"
