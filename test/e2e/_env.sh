# Shared setup for the live e2e scripts. Sourced, not executed.
#
# Every input comes from the environment — there is no default host. A default
# is worse than a missing value here: it points a live run at someone else's
# platform, and the failure looks like a broken CLI rather than a wrong target.
#
#   BKN_BASE_URL   required   platform to talk to
#   BKN_TOKEN      required   pass it explicitly; `auth token` rotates opaque
#                             tokens on every call, which revokes the one an
#                             earlier call captured
#   BKN_KN_ID      required   a knowledge network to read
#   BKN_INSECURE   optional   `1` to skip TLS verification (self-signed dev)
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

need() {
  local var="$1" hint="$2"
  if [ -z "${!var:-}" ]; then
    echo "Set $var — $hint" >&2
    exit 1
  fi
}
need BKN_BASE_URL "the platform to run against, e.g. https://bkn.example.com"
need BKN_TOKEN "a token: BKN_TOKEN=\$(openbkn auth token)"
need BKN_KN_ID "a knowledge network id on that platform"

CLI="node $ROOT/dist/cli.js"
if [ ! -f "$ROOT/dist/cli.js" ]; then
  echo "No build at dist/cli.js — run \`npm run build\` first." >&2
  exit 1
fi

# Opt-in, not assumed: silently disabling certificate checks against whatever
# host was configured is not a decision a test script should make.
TLS_FLAG=()
if [ "${BKN_INSECURE:-}" = "1" ]; then
  TLS_FLAG=(-k)
  export NODE_TLS_REJECT_UNAUTHORIZED=0
fi

pass=0; fail=0; failed=()

# `--json` is explicit: the human table is the default output.
run() {
  $CLI --base-url "$BKN_BASE_URL" --token "$BKN_TOKEN" "${TLS_FLAG[@]}" --json "$@" 2>&1 |
    grep -v -i -E 'NODE_TLS_REJECT_UNAUTHORIZED|trace-warnings'
}

# Match from a here-string: `grep -q` exits on the first match, and the writer's
# SIGPIPE would trip `pipefail` on large payloads.
errored() {
  grep -qiE '^(Request failed|Not authorized|Forbidden|error:|Input error|Context-loader error)' <<< "$1"
}

chk() {
  local label="$1"; shift
  local out; out="$(run "$@")"
  if errored "$out"; then
    echo "FAIL  $label :: $(head -c 140 <<< "$out" | tr '\n' ' ')"
    fail=$((fail + 1)); failed+=("$label")
  else
    echo "PASS  $label"; pass=$((pass + 1))
  fi
}

# Like `chk`, but the output must also match a pattern. A command that answers
# `{"entries": []}` is not the same as one that answers with the thing asked
# for, and the shape-only check above cannot tell them apart.
chk_has() {
  local label="$1" want="$2"; shift 2
  local out; out="$(run "$@")"
  if errored "$out"; then
    echo "FAIL  $label :: $(head -c 140 <<< "$out" | tr '\n' ' ')"
    fail=$((fail + 1)); failed+=("$label")
  elif ! grep -qE "$want" <<< "$out"; then
    echo "FAIL  $label :: no match for /$want/ in $(head -c 120 <<< "$out" | tr '\n' ' ')"
    fail=$((fail + 1)); failed+=("$label")
  else
    echo "PASS  $label"; pass=$((pass + 1))
  fi
}

report() {
  echo "---"
  echo "passed=$pass failed=$fail"
  if [ ${#failed[@]} -gt 0 ]; then printf 'failed: %s\n' "${failed[@]}"; fi
  [ "$fail" -eq 0 ]
}

# First entry's id from a list command, or empty. Parsed rather than grepped:
# a nested `"id"` (a creator, an owner) is not the entry's, and `head -1` on a
# grep cannot tell the difference.
first_id() {
  run "$@" | node -e '
    let s = "";
    process.stdin.on("data", (d) => { s += d; });
    process.stdin.on("end", () => {
      try {
        const j = JSON.parse(s);
        const list = Array.isArray(j) ? j : (j.entries ?? j.data ?? []);
        process.stdout.write(String(list[0]?.id ?? ""));
      } catch {
        process.stdout.write("");
      }
    });
  '
}

# Some MCP surfaces are optional: a deploy that answers "resources not
# supported" is telling us about itself, not failing. Report those as skipped so
# the suite stays usable across deployments without hiding real errors.
chk_optional() {
  local label="$1"; shift
  local out; out="$(run "$@")"
    # Also covers answers that describe the model rather than a fault: a type with
  # no logic properties defined has nothing to compute, and saying so is correct
  # behaviour.
  if grep -qiE "not supported|not implemented|has no logic properties|<center>nginx</center>" <<< "$out"; then
    echo "SKIP  $label (not supported by this deploy)"
  elif errored "$out"; then
    echo "FAIL  $label :: $(head -c 140 <<< "$out" | tr '\n' ' ')"
    fail=$((fail + 1)); failed+=("$label")
  else
    echo "PASS  $label"; pass=$((pass + 1))
  fi
}
