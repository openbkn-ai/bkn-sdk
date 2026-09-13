#!/usr/bin/env bash
#
# Live write-path e2e for `openbkn`. Separate from `live-suite.sh` because it
# creates things on the target platform: a skill package, a managed
# conversation, and whatever they drag along.
#
# Behind an explicit switch. Someone running the read-only suite against a
# shared platform should not discover afterwards that it also wrote there.
#
#   BKN_E2E_WRITE=1 BKN_BASE_URL=https://host [BKN_TOKEN=…] \
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
# The platform addresses a skill by the skill_id `register` hands back, never by
# its name: every call below that took the name answered 404 on 0.1.5.
SKILL_ID=""
CREATED_SKILL=""

cleanup() {
  local code=$?
  if [ -n "$CREATED_SKILL" ]; then
    echo "--- cleanup: deleting skill $CREATED_SKILL"
    # A published skill cannot be deleted, and a run stopped between the two
    # set-status checks leaves it published. Taking it offline first is a no-op
    # the delete does not depend on when it already is.
    run skill set-status "$CREATED_SKILL" offline >/dev/null 2>&1 || true
    # Best effort, and loud about failing: an orphan here is the next run's
    # confusing "already exists".
    if ! out="$(run skill delete "$CREATED_SKILL" 2>&1)"; then
      echo "WARN  could not delete $CREATED_SKILL :: $(head -c 140 <<< "$out" | tr '\n' ' ')" >&2
    fi
  fi
  rm -rf "$WORK"
  exit "$code"
}
# Cleanup hangs off EXIT alone; a signal only exits with its own status, which
# then runs it once. Trapping the signals to cleanup as well ran it twice (its
# `exit` fires EXIT again) and reported a killed run as a success.
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

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

register_out="$(run skill register "$WORK/skill")"
SKILL_ID="$(node -e '
  let s = "";
  process.stdin.on("data", (d) => { s += d; });
  process.stdin.on("end", () => {
    try {
      process.stdout.write(JSON.parse(s).skill_id || "");
    } catch {
      process.stdout.write("");
    }
  });
' <<< "$register_out")"
if errored "$register_out" || [ -z "$SKILL_ID" ]; then
  echo "FAIL  skill register :: $(head -c 140 <<< "$register_out" | tr '\n' ' ')"
  fail=$((fail + 1)); failed+=("skill register")
else
  echo "PASS  skill register ($SKILL_ID)"; pass=$((pass + 1))
  # Marked for cleanup as soon as the platform has handed back an id, so every
  # later failure still ends in a delete.
  CREATED_SKILL="$SKILL_ID"

  chk_has "skill get (after register)" "$SKILL_KEY" skill get "$SKILL_ID"
  chk_has "skill list includes it" "$SKILL_ID" skill list --limit 100
  # `set-status` accepts unpublish | published | offline — nothing else; the CLI
  # passes an unknown value straight through to the backend.
  chk "skill set-status published" skill set-status "$SKILL_ID" published
  # `files` and `read-file` read the published version, which a freshly
  # registered skill does not have yet — so they come after the publish.
  chk "skill files" skill files "$SKILL_ID"
  # Without --raw the answer is a download URL, not the text the name is in.
  chk_has "skill read-file SKILL.md" "$SKILL_KEY" skill read-file "$SKILL_ID" SKILL.md --raw
  # `download <skill-id> [out-path]` — the path is positional.
  chk "skill download" skill download "$SKILL_ID" "$WORK/roundtrip.zip"
  chk "skill history" skill history "$SKILL_ID"
  chk "skill set-status offline" skill set-status "$SKILL_ID" offline
fi

echo "### context managed lifecycle"
# The path a business call actually takes. On a deploy from 0.1.3 on these are
# rejected outright without a `bkn_context`, which the CLI opens for itself —
# so a break in that handshake surfaces here, with a real server on the other
# end rather than a mock agreeing with us.
chk_has "context call-method tools/list" '"(tools|name)"' context call-method "$BKN_KN_ID" tools/list
chk "context tool-call search_schema" context tool-call "$BKN_KN_ID" search_schema --arg query=team
chk_has "context conversation is remembered" '"(conversationId|source)"' context conversation

# The explicit Receipt output must be valid JSON, and the same identity must be
# able to read the durable record it names. This proves the CLI only emits the
# validated envelope after a real managed call; it deliberately does not claim
# cross-identity denial or exactly-once under a dropped response, both of which
# need an approved two-identity fault-injection target.
#
# The turn is opened here rather than by the CLI so its interaction id is known.
# Since foundry #1417 a completed receipt names no receipt, conversation or
# interaction; the durable record is found through the interaction's operations.
receipt_start="$(run context tool-call "$BKN_KN_ID" bkn_start_interaction \
  --args '{"conversation_mode":"new","question":"live-write receipt readback","agent_name":"openbkn-e2e"}')"
read -r receipt_conv receipt_int <<< "$(node -e '
  let s = "";
  process.stdin.on("data", (d) => { s += d; });
  process.stdin.on("end", () => {
    try {
      const j = JSON.parse(s);
      process.stdout.write(`${j.conversation_id || ""} ${j.interaction_id || ""}`);
    } catch {
      process.stdout.write("");
    }
  });
' <<< "$receipt_start")"
if errored "$receipt_start" || [ -z "${receipt_int:-}" ]; then
  echo "FAIL  context receipt turn opens :: $(head -c 140 <<< "$receipt_start" | tr '\n' ' ')"
  fail=$((fail + 1)); failed+=("context receipt turn")
else
  receipt_ctx="{\"conversation_id\":\"$receipt_conv\",\"interaction_id\":\"$receipt_int\"}"
  receipt_out="$(run context tool-call "$BKN_KN_ID" search_schema \
    --args "{\"query\":\"team\",\"bkn_context\":$receipt_ctx}" --receipt)"
  # Prints the receipt_id when the receipt carries one, "-" for a valid receipt
  # without it, and nothing for an invalid one. An identity field that is
  # present has to be a real id and, for the turn, the turn this call ran in.
  receipt_id="$(node -e '
    const [conv, int] = process.argv.slice(1);
    let s = "";
    process.stdin.on("data", (d) => { s += d; });
    process.stdin.on("end", () => {
      try {
        const r = JSON.parse(s)?.bkn_receipt;
        const present = (k) => r[k] !== undefined;
        const idOk = (k) => !present(k) || (typeof r[k] === "string" && r[k].length > 0);
        const valid = r && ["pending", "completed", "failed"].includes(r.receipt_status) &&
          ["receipt_id", "conversation_id", "interaction_id", "operation_id"].every(idOk) &&
          (!present("conversation_id") || r.conversation_id === conv) &&
          (!present("interaction_id") || r.interaction_id === int);
        process.stdout.write(valid ? (r.receipt_id || "-") : "");
      } catch {
        process.stdout.write("");
      }
    });
  ' "$receipt_conv" "$receipt_int" <<< "$receipt_out")"
  if errored "$receipt_out" || [ -z "$receipt_id" ]; then
    echo "FAIL  context tool-call --receipt emits a validated envelope :: $(head -c 140 <<< "$receipt_out" | tr '\n' ' ')"
    fail=$((fail + 1)); failed+=("context receipt envelope")
  else
    echo "PASS  context tool-call --receipt emits a validated envelope"; pass=$((pass + 1))
    if [ "$receipt_id" = "-" ]; then
      receipt_id="$(node -e '
        let s = "";
        process.stdin.on("data", (d) => { s += d; });
        process.stdin.on("end", () => {
          try {
            const op = (JSON.parse(s).entries || []).find((e) => e.tool_name === "search_schema");
            process.stdout.write(op?.receipt_id || "");
          } catch {
            process.stdout.write("");
          }
        });
      ' <<< "$(run trace interactions operations "$receipt_int")")"
    fi
    if [ -z "$receipt_id" ]; then
      echo "FAIL  trace receipt current-identity readback :: no search_schema receipt in $receipt_int"
      fail=$((fail + 1)); failed+=("trace receipt current-identity readback")
    else
      chk_has "trace receipt current-identity readback" "\"interaction_id\": *\"$receipt_int\"" \
        trace receipts get "$receipt_id"
    fi
  fi
  # Close the turn this block opened; a live one would be left for the server to expire.
  run context tool-call "$BKN_KN_ID" bkn_finish_interaction \
    --args "{\"interaction_id\":\"$receipt_int\",\"outcome\":\"completed\",\"answer\":\"live-write receipt readback\"}" >/dev/null
fi

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
