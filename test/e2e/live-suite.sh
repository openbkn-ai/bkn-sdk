#!/usr/bin/env bash
#
# Broad live suite for `openbkn` against a real platform — wider than
# `live-smoke.sh`: auth/config, every KN read, vega, resources, models, skills,
# toolboxes, the MCP (context) surface, admin reads, and the passthrough.
# Read-only: it creates nothing and deletes nothing.
#
#   BKN_TOKEN=$(openbkn auth token) BKN_BASE_URL=https://host BKN_KN_ID=<kn> \
#     test/e2e/live-suite.sh
#
# Pass BKN_TOKEN explicitly: `auth token` refreshes opaque tokens on every call,
# and the rotation revokes a token captured by an earlier call.
# Not part of `npm test` (real backend).
set -uo pipefail
export NODE_TLS_REJECT_UNAUTHORIZED=0

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CLI="node $ROOT/dist/cli.js"
BASE="${BKN_BASE_URL:-https://10.211.55.4}"
TOKEN="${BKN_TOKEN:-$($CLI auth token 2>/dev/null)}"
KN="${BKN_KN_ID:-}"

if [ -z "$TOKEN" ]; then
  echo "No token. Log in first (or set BKN_TOKEN)." >&2
  exit 1
fi
if [ -z "$KN" ]; then
  echo "Set BKN_KN_ID to a knowledge network on the target platform." >&2
  exit 1
fi

pass=0; fail=0; failed=()
# --json is explicit: the human table is the default output.
run() { $CLI --base-url "$BASE" --token "$TOKEN" -k --json "$@" 2>&1 | grep -v -i -E 'NODE_TLS_REJECT_UNAUTHORIZED|trace-warnings'; }
chk() {
  local label="$1"; shift
  local out; out="$(run "$@")"
  # Match from a here-string: `grep -q` exits on the first match, and the
  # writer's SIGPIPE would trip `pipefail` on large payloads.
  if grep -qiE '^(Request failed|Not authorized|Forbidden|error:|Input error|Context-loader error)' <<< "$out"; then
    echo "FAIL  $label :: $(head -c 140 <<< "$out" | tr '\n' ' ')"
    fail=$((fail + 1)); failed+=("$label")
  else
    echo "PASS  $label"; pass=$((pass + 1))
  fi
}

echo "### auth / config"
chk "auth whoami" auth whoami
chk "auth list" auth list
chk "config show" config show
chk "appkey list" appkey list

echo "### knowledge networks"
chk "bkn list" bkn list --limit 100
chk "bkn get --stats" bkn get "$KN" --stats
chk "bkn search" bkn search "$KN" "team"
chk "bkn object-type list" bkn object-type list "$KN"
chk "bkn relation-type list" bkn relation-type list "$KN"
chk "bkn action-type list" bkn action-type list "$KN"
chk "bkn metric list" bkn metric list "$KN"
chk "bkn concept-group list" bkn concept-group list "$KN"
chk "bkn action-schedule list" bkn action-schedule list "$KN"
chk "bkn action-log list" bkn action-log list "$KN"
chk "bkn resources" bkn resources
# Reads tunnelled over POST — they need the X-HTTP-Method-Override header.
chk "bkn relation-type-paths" bkn relation-type-paths "$KN" \
  --body '{"source_object_type_id":"'"${BKN_OT_ID:-}"'","direction":"forward","path_length":1}'
chk "bkn subgraph" bkn subgraph "$KN" \
  --body '{"source_object_type_id":"'"${BKN_OT_ID:-}"'","direction":"forward","path_length":1,"limit":1}'

echo "### vega / resources"
chk "vega catalog list" vega catalog list --limit 5
chk "vega connector-type list" vega connector-type list
chk "vega resource list" vega resource list --limit 5
chk "vega dataset build-list" vega dataset build-list --limit 3
chk "resource list" resource list --limit 5
chk "resource find" resource find --name a --limit 50

echo "### models"
chk "model llm list" model llm list
chk "model small list" model small list
chk "model small get-default" model small get-default --type embedding

echo "### skills / toolboxes"
chk "skill list" skill list
chk "skill market" skill market --limit 5
chk "toolbox list" toolbox list

echo "### context (MCP)"
chk "context info" context info
chk "context tools" context tools "$KN"
chk "context kn-detail" context kn-detail "$KN"
chk "context search-schema" context search-schema "$KN" "team"

echo "### trace"
chk "trace validate-fixture" trace validate-fixture "$ROOT/fixtures/bkn-trace/positive.json"

echo "### admin (operator reads)"
chk "admin org list" admin org list
chk "admin user list" admin user list --limit 5
chk "admin role list" admin role list
chk "admin llm list" admin llm list
chk "admin license fingerprint" admin license fingerprint

echo "### passthrough"
chk "call ontology KN list" call "/api/ontology-manager/v1/knowledge-networks?page=1&size=1"

echo "---"
echo "passed=$pass failed=$fail"
if [ ${#failed[@]} -gt 0 ]; then printf 'failed: %s\n' "${failed[@]}"; fi
[ "$fail" -eq 0 ]
