#!/usr/bin/env bash
#
# Live read-path smoke test for `openbkn` against a real platform.
# Reuses an existing legacy CLI session for the token (refresh needs TLS bypass
# on self-signed platforms, hence NODE_TLS_REJECT_UNAUTHORIZED=0).
#
#   BKN_BASE_URL=https://host  BKN_KN_ID=<kn>  test/e2e/live-smoke.sh
#
# Defaults target the dev VM. Not part of `npm test` (real backend).
set -uo pipefail
export NODE_TLS_REJECT_UNAUTHORIZED=0

BASE="${BKN_BASE_URL:-https://10.211.55.4}"
CLI="node $(cd "$(dirname "$0")/../.." && pwd)/dist/cli.js"
TOKEN="${BKN_TOKEN:-$($CLI auth token 2>/dev/null)}"
KN="${BKN_KN_ID:-}"

if [ -z "$TOKEN" ]; then
  echo "No token. Log in first (or set BKN_TOKEN)." >&2
  exit 1
fi

o() { $CLI --base-url "$BASE" --token "$TOKEN" -k "$@" 2>&1 | grep -v -i warning; }
pass=0; fail=0
check() {
  local label="$1"; shift
  if o "$@" | grep -qE '"(entries|data|count|id|name|total|tools|concepts|object_types)"|^\[|\[\]'; then
    echo "✅ $label"; pass=$((pass + 1))
  else
    echo "❌ $label"; fail=$((fail + 1))
  fi
}

check "bkn list" bkn list
check "resource list" resource list --limit 1
check "vega catalog list" vega catalog list --limit 1
check "vega resource list" vega resource list --limit 1
check "agent list" agent list --limit 1
check "model llm list" model llm list --limit 1
check "model small list" model small list --limit 1
check "skill list" skill list --limit 1
check "toolbox list" toolbox list --limit 1
check "dataflow list" dataflow list
if [ -n "$KN" ]; then
  check "bkn object-type list" bkn object-type list "$KN"
  check "bkn action-log list" bkn action-log list "$KN"
  check "context tools" context tools "$KN"
fi

# Operator (admin) endpoints need an operator token; run only when one is
# provided. License checks are reads (fingerprint works with no license
# installed; show reports state=invalid then — both count as reachable).
if [ -n "${BKN_ADMIN_TOKEN:-}" ]; then
  a() { $CLI --base-url "$BASE" --token "$BKN_ADMIN_TOKEN" -k "$@" 2>&1 | grep -v -i warning; }
  acheck() {
    local label="$1"; shift
    if a "$@" | grep -qE '"(instance_fp|state)"'; then
      echo "✅ $label"; pass=$((pass + 1))
    else
      echo "❌ $label"; fail=$((fail + 1))
    fi
  }
  acheck "admin license fingerprint" admin license fingerprint
  acheck "admin license show" admin license show
fi

echo "---"
echo "passed=$pass failed=$fail"
# Remaining operator (admin) endpoints need dedicated fixtures; skipped by design.
[ "$fail" -eq 0 ]
