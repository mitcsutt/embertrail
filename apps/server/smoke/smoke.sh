#!/usr/bin/env bash
# Smoke test for the Docker Platform (#37): boots the compose stack from the repository root,
# runs the built CLI's `setup claude-code` against it, ingests Claude Code fixtures with the
# credentials the CLI wrote and queries them back. CI runs it; so can you:
#   apps/server/smoke/smoke.sh
# It uses its own compose project and a random local port, and removes both volumes and image
# containers when it ends. Needs docker, curl, jq, pnpm and a built CLI (`pnpm --filter
# @mitcsutt/embertrail-cli build`); the CLI runs with a temporary HOME, so your own
# ~/.claude is never touched. It also starts the Dashboard (`--profile dashboard`) and checks it
# serves the app and reads the seeded demo dataset through its proxy.
set -euo pipefail

root=$(cd "$(dirname "$0")/../../.." && pwd)
fixtures="$root/packages/otel/test/fixtures/claude-code"
project="embertrail-smoke-$$"
export EMBERTRAIL_PORT=${EMBERTRAIL_PORT:-$((20000 + RANDOM % 20000))}
export DASHBOARD_PORT=${DASHBOARD_PORT:-$((40000 + RANDOM % 20000))}
hub="http://localhost:$EMBERTRAIL_PORT"
dashboard="http://localhost:$DASHBOARD_PORT"

compose() { docker compose --project-directory "$root" -p "$project" "$@"; }
fail() { echo "smoke: FAIL: $*" >&2; compose --profile dashboard logs --no-color hub dashboard >&2 || true; exit 1; }
home=$(mktemp -d)
cleanup() {
  rm -rf "$home"
  compose --profile dashboard down --volumes --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

cli="$root/packages/cli/dist/bin.js"
[ -f "$cli" ] || { echo "smoke: build the CLI first: pnpm --filter @mitcsutt/embertrail-cli build" >&2; exit 1; }

echo "smoke: starting $project on $hub"
compose up --detach --build --wait

tokens() { compose logs --no-color hub | grep -oE 'et_[a-z0-9]{16}_[A-Za-z0-9]{40}' | sort -u || true; }

management=$(tokens | head -n 1)
[ -n "$management" ] || fail "no management Token in the Hub's log"
[ "$(tokens | wc -l)" -eq 1 ] || fail "expected exactly one Token in the log"

api() { # api METHOD PATH TOKEN [BODY-FILE]
  local method=$1 path=$2 token=$3
  shift 3
  curl --silent --show-error --fail-with-body --request "$method" "$hub$path" \
    --header "authorization: Bearer $token" --header 'content-type: application/json' "$@"
}

echo "smoke: the printed Token manages the Hub, and the CLI sets up Claude Code with it"
# HOME is a temporary directory and CLAUDE_CONFIG_DIR is unset, so the settings file lands in
# $home/.claude and the real one is never read or written.
env -u CLAUDE_CONFIG_DIR HOME="$home" EMBERTRAIL_CONFIG_DIR="$home/embertrail" \
  EMBERTRAIL_HUB="$hub" EMBERTRAIL_TOKEN="$management" \
  node "$cli" setup claude-code --source smoke >/dev/null || fail "embertrail setup claude-code failed"
settings="$home/.claude/settings.json"
[ -f "$settings" ] || fail "setup claude-code wrote no settings file at $settings"
endpoint=$(jq -r '.env.OTEL_EXPORTER_OTLP_ENDPOINT // empty' "$settings")
headers=$(jq -r '.env.OTEL_EXPORTER_OTLP_HEADERS // empty' "$settings")
[ "$endpoint" = "$hub" ] || fail "the written env block has endpoint '$endpoint', expected $hub"
case "$headers" in
  'Authorization=Bearer et_'*) ;;
  *) fail "the written env block has no Authorization header" ;;
esac
ingest=${headers#Authorization=Bearer }

echo "smoke: the Dashboard serves the app and reads the seeded demo dataset through its proxy"
# Before the fixtures go in, so the seed command checks the counts of a Hub holding only its own Source.
# The Token is set for this one service, the way a person puts it in .env.
EMBERTRAIL_DASHBOARD_TOKEN="$management" compose --profile dashboard up --detach --build --wait dashboard
EMBERTRAIL_HUB="$hub" EMBERTRAIL_TOKEN="$management" \
  pnpm --dir "$root" --filter @mitcsutt/embertrail-dashboard seed >"$home/seed.log" 2>&1 || { cat "$home/seed.log" >&2; fail "pnpm seed failed"; }
page=$(curl --silent --fail "$dashboard/boards/overview") || fail "the Dashboard did not serve a Board URL"
grep -q 'id="root"' <<<"$page" || fail "the Dashboard's page has no #root"
[ "$(curl --silent --fail "$dashboard/config.json" | jq -r '.hubUrl')" = "" ] || fail "config.json has no empty hubUrl"
curl --silent --fail --head "$dashboard/config.json" | grep -qi '^cache-control: no-cache' || fail "config.json is cacheable"
# The browser sends no Token; the proxy adds it.
[ "$(curl --silent --fail "$dashboard/api/v1/self" | jq -r '.user.admin')" = "true" ] || fail "/api/v1/self through the Dashboard"
sessions=$(curl --silent --fail "$dashboard/api/v1/sessions?limit=1000")
[ "$(jq '.items | length' <<<"$sessions")" -ge 100 ] || fail "the demo Sessions did not come through the Dashboard: $(head -c 300 <<<"$sessions")"
# A page on another origin must not be written as the Token's User.
for header in 'Sec-Fetch-Site: cross-site' 'Origin: http://other.example'; do
  [ "$(curl --silent --output /dev/null --write-out '%{http_code}' --header "$header" "$dashboard/api/v1/self")" = 404 ] || fail "'$header' reached the Hub"
done
[ "$(curl --silent --output /dev/null --write-out '%{http_code}' --header "Origin: $dashboard" --header 'Sec-Fetch-Site: same-origin' "$dashboard/api/v1/self")" = 200 ] || fail "a same-origin request was refused"

echo "smoke: ingesting the fixtures with the credentials the CLI wrote"
for pair in logs-startup:logs logs-turn:logs metrics-first:metrics metrics-second:metrics; do
  file=${pair%%:*}; signal=${pair##*:}
  api POST "/v1/$signal" "$ingest" --data-binary "@$fixtures/$file.json" >/dev/null
done

echo "smoke: querying it back"
sessions=$(api GET /api/v1/sessions "$management")
[ "$(jq '.items | length' <<<"$sessions")" -ge 1 ] || fail "no Session came back: $sessions"
events=$(api POST /api/v1/events/query "$management" --data '{"mode":"list","from":"2020-01-01T00:00:00Z","to":"2100-01-01T00:00:00Z","tz":"UTC"}')
[ "$(jq '.items | length' <<<"$events")" -ge 1 ] || fail "no Event came back: $events"

echo "smoke: a restart prints no second Token and creates no second User"
compose restart hub
for _ in $(seq 60); do curl --silent --fail "$hub/api/v1/openapi.json" >/dev/null && break; sleep 1; done
curl --silent --fail "$hub/api/v1/openapi.json" >/dev/null || fail "the Hub did not come back after the restart"
# The log may start empty after a restart, so only a Token other than the first is a failure.
[ -z "$(tokens | grep -vxF "$management" || true)" ] || fail "a restart printed another Token"
[ "$(api GET /api/v1/admin/users "$management" | jq '.items | length')" -eq 1 ] || fail "expected one User"

echo "smoke: ok"
