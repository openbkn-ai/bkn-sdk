#!/usr/bin/env bash
#
# Live write-path e2e for `openbkn`. Separate from `live-suite.sh` because it
# creates things on the target platform: a skill package, a managed
# conversation, and whatever they drag along.
#
# Behind an explicit switch. Someone running the read-only suite against a
# shared platform should not discover afterwards that it also wrote there.
#
#   BKN_E2E_WRITE=1 BKN_BASE_URL=https://host BKN_TOKEN=$(openbkn auth token) \
#     BKN_KN_ID=<kn> [BKN_INSECURE=1] test/e2e/live-write.sh
#
# Everything it creates is removed on the way out, including on failure and on
# Ctrl-C — a half-finished run must not leave a name that makes the next run
# fail for a different reason.
#
# Not part of `npm test` (real backend).
# The safety gate comes before everything else, including the checks that need
# the environment: whether this script may write is not a question a missing
# build or an unset variable should get to answer first.
if [ "${BKN_E2E_WRITE:-}" != "1" ]; then
  echo "Refusing to run without BKN_E2E_WRITE=1 — this script creates and deletes on the target platform." >&2
  exit 1
fi

# shellcheck source=test/e2e/_env.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_env.sh"

if ! command -v zip >/dev/null 2>&1; then
  echo "Needs \`zip\` to build the skill package (macOS ships it; apt: zip)." >&2
  exit 1
fi

# A name nobody else will pick, and one a human can trace back to a run.
STAMP="$(date +%Y%m%d-%H%M%S)-$$"
SKILL_KEY="e2e-write-$STAMP"
WORK="$(mktemp -d)"
CREATED_SKILL=""

cleanup() {
  local code=$?
  if [ -n "$CREATED_SKILL" ]; then
    echo "--- cleanup: deleting skill $CREATED_SKILL"
    # Best effort, and loud about failing: an orphan here is the next run's
    # confusing "already exists".
    if ! out="$(run skill delete "$CREATED_SKILL" 2>&1)"; then
      echo "WARN  could not delete $CREATED_SKILL :: $(head -c 140 <<< "$out" | tr '\n' ' ')" >&2
    fi
  fi
  rm -rf "$WORK"
  exit "$code"
}
trap cleanup EXIT INT TERM

echo "### skill lifecycle ($SKILL_KEY)"

# A minimal but real package: `register` takes a zip whose SKILL.md carries the
# frontmatter the platform reads.
mkdir -p "$WORK/skill"
cat > "$WORK/skill/SKILL.md" <<SKILLMD
---
name: $SKILL_KEY
description: Temporary package created by live-write.sh; safe to delete.
---

# $SKILL_KEY

Created by the openbkn e2e write suite. If this is still here, a run was
interrupted before its cleanup.
SKILLMD
(cd "$WORK/skill" && zip -qr "../$SKILL_KEY.zip" .)

chk "skill register" skill register "$WORK/$SKILL_KEY.zip"
# Only mark it for cleanup once the platform has actually taken it: deleting a
# name that was never created buries the real error under a second one.
if run skill get "$SKILL_KEY" >/dev/null 2>&1; then
  CREATED_SKILL="$SKILL_KEY"
fi

chk_has "skill get (after register)" "$SKILL_KEY" skill get "$SKILL_KEY"
chk_has "skill list includes it" "$SKILL_KEY" skill list --limit 100
chk "skill files" skill files "$SKILL_KEY"
chk_has "skill read-file SKILL.md" "$SKILL_KEY" skill read-file "$SKILL_KEY" SKILL.md
chk "skill set-status enabled" skill set-status "$SKILL_KEY" enabled
chk "skill download" skill download "$SKILL_KEY" --output "$WORK/roundtrip.zip"
chk "skill history" skill history "$SKILL_KEY"

echo "### context managed lifecycle"
# The path a business call actually takes. On a deploy from 0.1.3 on these are
# rejected outright without a `bkn_context`, which the CLI opens for itself —
# so a break in that handshake surfaces here, with a real server on the other
# end rather than a mock agreeing with us.
chk_has "context call-method tools/list" '"(tools|name)"' context call-method "$BKN_KN_ID" tools/list
chk "context tool-call search_schema" context tool-call "$BKN_KN_ID" search_schema --arg query=team
chk_has "context conversation is remembered" '"(conversationId|source)"' context conversation

# The remembered conversation has to survive a second command, which is the
# whole point of remembering it.
first="$(run context conversation | tr -d ' \n')"
second="$(run context conversation | tr -d ' \n')"
if [ "$first" = "$second" ]; then
  echo "PASS  conversation is stable across commands"; pass=$((pass + 1))
else
  echo "FAIL  conversation changed between commands :: $first vs $second"
  fail=$((fail + 1)); failed+=("conversation stability")
fi

chk "context conversation --forget" context conversation --forget

report
