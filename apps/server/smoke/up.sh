#!/usr/bin/env bash
# Smoke test for the local stack (docs/local-stack.md): the built CLI's `embertrail up` from
# nothing, with the images built from this checkout, then status, a second up, down, and reset.
# CI runs it after smoke.sh; so can you:
#   apps/server/smoke/up.sh
# Its own Compose project, random local ports and temporary config, stack and Claude Code
# directories, so your own stack, login and ~/.claude are never touched. HOME stays, since Docker
# finds its Compose plugin there on some machines. Needs docker, curl, jq and a built CLI (`pnpm --filter
# @mitcsutt/embertrail-cli build`).
set -euo pipefail

root=$(cd "$(dirname "$0")/../../.." && pwd)
cli="$root/packages/cli/dist/bin.js"
[ -f "$cli" ] || { echo "up smoke: build the CLI first: pnpm --filter @mitcsutt/embertrail-cli build" >&2; exit 1; }
project="embertrail-up-smoke-$$"
hub_port=$((20000 + RANDOM % 20000))
dashboard_port=$((40000 + RANDOM % 20000))
hub="http://localhost:$hub_port"
dashboard="http://localhost:$dashboard_port"
home=$(mktemp -d)

embertrail() {
  env -u EMBERTRAIL_HUB -u EMBERTRAIL_TOKEN CLAUDE_CONFIG_DIR="$home/claude" \
    EMBERTRAIL_LOCAL_DIR="$home/local" EMBERTRAIL_CONFIG_DIR="$home/config" \
    node "$cli" "$@"
}
fail() {
  echo "up smoke: FAIL: $*" >&2
  embertrail logs >&2 || true
  exit 1
}
cleanup() {
  docker compose -p "$project" --file "$home/local/compose.yaml" --env-file "$home/local/.env" \
    --profile dashboard down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$home"
}
trap cleanup EXIT

echo "up smoke: embertrail up from nothing ($project on $hub and $dashboard)"
embertrail up --project "$project" --hub-port "$hub_port" --dashboard-port "$dashboard_port" \
  --build-from "$root" --source smoke >"$home/up.log" 2>&1 || { cat "$home/up.log" >&2; fail "embertrail up failed"; }
grep -q "$dashboard" "$home/up.log" || fail "up did not print the Dashboard's URL"
! grep -qE 'et_[a-z0-9]{16}_' "$home/up.log" || fail "up printed a Token"

status=$(embertrail status --json)
[ "$(jq -r .running <<<"$status")" = true ] || fail "status does not say running: $status"
[ "$(jq -r .claude_code <<<"$status")" = true ] || fail "status does not see Claude Code: $status"

echo "up smoke: the Dashboard reads the Hub with its own Token, and the browser sends none"
[ "$(curl --silent --fail "$dashboard/api/v1/self" | jq -r '.user.admin')" = true ] || fail "/api/v1/self through the Dashboard"
[ "$(curl --silent --output /dev/null --write-out '%{http_code}' "$dashboard/api/v1/admin/users")" = 403 ] || fail "the Dashboard's Token can reach the Admin API"

echo "up smoke: Claude Code's settings send to the Hub"
settings="$home/claude/settings.json"
[ "$(jq -r '.env.OTEL_EXPORTER_OTLP_ENDPOINT' "$settings")" = "$hub" ] || fail "settings endpoint"
ingest=$(jq -r '.env.OTEL_EXPORTER_OTLP_HEADERS' "$settings")
ingest=${ingest#Authorization=Bearer }
curl --silent --fail --request POST "$hub/v1/logs" --header "authorization: Bearer $ingest" \
  --header 'content-type: application/json' \
  --data-binary "@$root/packages/otel/test/fixtures/claude-code/logs-startup.json" >/dev/null || fail "ingest with the written Token"
[ "$(curl --silent --fail "$dashboard/api/v1/sessions" | jq '.items | length')" -ge 1 ] || fail "the ingested Session through the Dashboard"

echo "up smoke: a second up changes nothing"
before=$(cat "$settings" "$home/local/.env")
embertrail up >/dev/null 2>&1 || fail "the second up failed"
[ "$before" = "$(cat "$settings" "$home/local/.env")" ] || fail "the second up changed the settings or the stack"

echo "up smoke: down keeps the data, up brings it back"
embertrail down >/dev/null 2>&1 || fail "down failed"
[ "$(embertrail status --json | jq -r .running)" = false ] || fail "status after down"
embertrail up >/dev/null 2>&1 || fail "up after down failed"
[ "$(curl --silent --fail "$dashboard/api/v1/sessions" | jq '.items | length')" -ge 1 ] || fail "the Session did not survive down"

echo "up smoke: reset deletes the stack and unhooks Claude Code"
embertrail reset --yes >/dev/null 2>&1 || fail "reset failed"
[ "$(jq -r '.env.OTEL_EXPORTER_OTLP_ENDPOINT // "gone"' "$settings")" = gone ] || fail "reset left the telemetry settings"
[ -z "$(docker volume ls --quiet --filter "name=${project}_postgres-data")" ] || fail "reset left the volume"

echo "up smoke: ok"
