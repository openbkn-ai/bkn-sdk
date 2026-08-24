#!/usr/bin/env bash
#
# Live read-path smoke test for `openbkn` against a real platform — the short
# one. `live-suite.sh` is the broad read-only pass; `live-write.sh` is the one
# that creates things.
#
#   BKN_BASE_URL=https://host [BKN_TOKEN=…] BKN_KN_ID=<kn> \
#     [BKN_INSECURE=1] test/e2e/live-smoke.sh
#
# Not part of `npm test` (real backend).
# shellcheck source=test/e2e/_env.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_env.sh"

# This file's own pass/fail wording, kept as it was; `_env.sh` supplies `run`
# and the counters.
check() {
  local label="$1"; shift
  local out; out="$(run "$@")"
  if errored "$out"; then
    echo "❌ $label"; fail=$((fail + 1)); failed+=("$label")
  else
    echo "✅ $label"; pass=$((pass + 1))
  fi
}

# Agent-factory and automation (dataflow) are optional deployments: the ingress
# answers with nginx's own 404 HTML when the service isn't installed, which is a
# missing backend, not a broken command.
skipped=0
optional_check() {
  local label="$1"; shift
  local out; out="$(run "$@")"
  if grep -q '<center>nginx</center>' <<< "$out"; then
    echo "⏭️  $label (service not deployed)"; skipped=$((skipped + 1)); return
  fi
  if grep -qE '"(entries|data|count|id|name|total)"|^\[|\[\]' <<< "$out"; then
    echo "✅ $label"; pass=$((pass + 1))
  else
    echo "❌ $label"; fail=$((fail + 1))
  fi
}

check "bkn list" bkn list
check "resource list" resource list --limit 1
check "vega catalog list" vega catalog list --limit 1
check "vega resource list" vega resource list --limit 1
optional_check "agent list" agent list --limit 1
check "model llm list" model llm list --limit 1
check "model small list" model small list --limit 1
check "skill list" skill list --limit 1
check "toolbox list" toolbox list --limit 1
optional_check "dataflow list" dataflow list
if [ -n "$BKN_KN_ID" ]; then
  check "bkn object-type list" bkn object-type list "$BKN_KN_ID"
  check "bkn action-log list" bkn action-log list "$BKN_KN_ID"
  check "context tools" context tools "$BKN_KN_ID"
fi

# Operator (admin) endpoints need an operator token; run only when one is
# provided. License checks are reads (fingerprint works with no license
# installed; show reports state=invalid then — both count as reachable).
if [ -n "${BKN_ADMIN_TOKEN:-}" ]; then
  a() { $CLI --base-url "$BKN_BASE_URL" --token "$BKN_ADMIN_TOKEN" ${TLS_FLAG[@]+"${TLS_FLAG[@]}"} --json "$@" 2>&1 | grep -v -i warning; }
  acheck() {
    local label="$1"; shift
    local out; out="$(a "$@")"
    if grep -qE '"(instance_fp|state)"' <<< "$out"; then
      echo "✅ $label"; pass=$((pass + 1))
    else
      echo "❌ $label"; fail=$((fail + 1))
    fi
  }
  acheck "admin license fingerprint" admin license fingerprint
  acheck "admin license show" admin license show
fi

echo "---"
echo "passed=$pass failed=$fail skipped=$skipped"
# Remaining operator (admin) endpoints need dedicated fixtures; skipped by design.
[ "$fail" -eq 0 ]
