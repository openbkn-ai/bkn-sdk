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

# `register` takes the directory and zips it itself, so this only has to be a
# real skill layout: a SKILL.md whose frontmatter the platform reads.
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

chk "skill register" skill register "$WORK/skill"
# Only mark it for cleanup once the platform has actually taken it: deleting a
# name that was never created buries the real error under a second one.
if run skill get "$SKILL_KEY" >/dev/null 2>&1; then
  CREATED_SKILL="$SKILL_KEY"
fi

chk_has "skill get (after register)" "$SKILL_KEY" skill get "$SKILL_KEY"
chk_has "skill list includes it" "$SKILL_KEY" skill list --limit 100
chk "skill files" skill files "$SKILL_KEY"
chk_has "skill read-file SKILL.md" "$SKILL_KEY" skill read-file "$SKILL_KEY" SKILL.md
# `set-status` accepts unpublish | published | offline — nothing else; the CLI
# passes an unknown value straight through to the backend.
chk "skill set-status published" skill set-status "$SKILL_KEY" published
chk "skill set-status offline" skill set-status "$SKILL_KEY" offline
# `download <skill-id> [out-path]` — the path is positional.
chk "skill download" skill download "$SKILL_KEY" "$WORK/roundtrip.zip"
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
# Compare the id itself, not the whole payload: two empty outputs are equal,
# and so are two identical error messages — both would have passed.
first="$(run context conversation | grep -oE '"conversationId" *: *"[^"]+"' | head -1)"
second="$(run context conversation | grep -oE '"conversationId" *: *"[^"]+"' | head -1)"
if [ -z "$first" ]; then
  echo "FAIL  no conversation was opened, so stability cannot be judged"
  fail=$((fail + 1)); failed+=("conversation stability")
elif [ "$first" = "$second" ]; then
  echo "PASS  conversation is stable across commands"; pass=$((pass + 1))
else
  echo "FAIL  conversation changed between commands :: $first vs $second"
  fail=$((fail + 1)); failed+=("conversation stability")
fi

chk "context conversation --forget" context conversation --forget

report
