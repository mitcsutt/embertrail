#!/usr/bin/env bash
# Smoke test for the Docker Platform (#37): boots the compose stack from the repository root,
# ingests a Claude Code fixture and queries it back. CI runs it; so can you:
#   apps/server/smoke/smoke.sh
# It uses its own compose project and a random local port, and removes both volumes and image
# containers when it ends. Needs docker, curl and jq.
set -euo pipefail

root=$(cd "$(dirname "$0")/../../.." && pwd)
fixtures="$root/packages/otel/test/fixtures/claude-code"
project="embertrail-smoke-$$"
export EMBERTRAIL_PORT=${EMBERTRAIL_PORT:-$((20000 + RANDOM % 20000))}
hub="http://localhost:$EMBERTRAIL_PORT"

compose() { docker compose --project-directory "$root" -p "$project" "$@"; }
fail() { echo "smoke: FAIL: $*" >&2; compose logs --no-color hub >&2 || true; exit 1; }
cleanup() { compose down --volumes --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT

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

echo "smoke: the printed Token manages the Hub"
ingest=$(api POST /api/v1/self/sources "$management" --data '{"name":"smoke"}' | jq -r .token.token)
[ -n "$ingest" ] && [ "$ingest" != null ] || fail "no ingest Token"

echo "smoke: ingesting the fixtures"
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
compose up --detach --wait
[ "$(tokens | wc -l)" -eq 1 ] || fail "a restart printed another Token"
[ "$(api GET /api/v1/admin/users "$management" | jq 'length')" -eq 1 ] || fail "expected one User"

echo "smoke: ok"
