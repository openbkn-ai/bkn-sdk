#!/usr/bin/env bash
#
# Broad read-only live suite for `openbkn` against a real platform — auth/config,
# every KN read, vega, resources, models, skills, toolboxes, the MCP (context)
# surface, admin reads, and the passthrough. Creates nothing, deletes nothing.
#
# Write paths live in `live-write.sh`, behind their own switch.
#
#   BKN_BASE_URL=https://host BKN_TOKEN=$(openbkn auth token) BKN_KN_ID=<kn> \
#     [BKN_INSECURE=1] test/e2e/live-suite.sh
#
# Not part of `npm test` (real backend).
# shellcheck source=test/e2e/_env.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_env.sh"

echo "### auth / config"
chk "auth whoami" auth whoami
chk "auth list" auth list
chk "config show" config show
chk "appkey list" appkey list

echo "### knowledge networks"
# Ids the checks below feed to commands that take one. Read from the platform
# rather than invented, and empty when the network has none — which is a fact
# about the network, not a failure.
OT_ID="$(first_id bkn object-type list "$BKN_KN_ID")"
RT_ID="$(first_id bkn relation-type list "$BKN_KN_ID")"
AT_ID="$(first_id bkn action-type list "$BKN_KN_ID")"

chk "bkn list" bkn list --limit 100
chk "bkn get --stats" bkn get "$BKN_KN_ID" --stats
chk "bkn search" bkn search "$BKN_KN_ID" "team"
chk "bkn object-type list" bkn object-type list "$BKN_KN_ID"
chk "bkn relation-type list" bkn relation-type list "$BKN_KN_ID"
chk "bkn action-type list" bkn action-type list "$BKN_KN_ID"
chk "bkn metric list" bkn metric list "$BKN_KN_ID"
chk "bkn concept-group list" bkn concept-group list "$BKN_KN_ID"
chk "bkn action-schedule list" bkn action-schedule list "$BKN_KN_ID"
chk "bkn action-log list" bkn action-log list "$BKN_KN_ID"
chk "bkn resources" bkn resources
# Reads tunnelled over POST — they need the X-HTTP-Method-Override header.
#
# Both need a body naming a source object type, a direction and a path length;
# omit any and the backend answers 400. They had one, keyed off `BKN_OT_ID` —
# a variable nothing sets, so every run sent an empty id and got
# `NullParameter.SourceObjectTypeId`. The id comes from the network now.
if [ -n "${OT_ID:-}" ]; then
  PATH_BODY="{\"source_object_type_id\":\"$OT_ID\",\"direction\":\"bidirectional\",\"path_length\":1}"
  chk "bkn relation-type-paths" bkn relation-type-paths "$BKN_KN_ID" --body "$PATH_BODY"
  chk "bkn subgraph" bkn subgraph "$BKN_KN_ID" --body "$PATH_BODY"
else
  echo "SKIP  bkn relation-type-paths/subgraph (no object type in $BKN_KN_ID)"
fi

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
# Read paths that need a skill to exist. `SKILL_KEY` names one already on the
# platform; without it the identity-scoped reads are skipped rather than failed,
# since "no skills installed" is a fact about the platform, not a defect.
if [ -n "${BKN_SKILL_KEY:-}" ]; then
  chk "skill get" skill get "$BKN_SKILL_KEY"
  chk "skill names" skill names "$BKN_SKILL_KEY"
  chk "skill files" skill files "$BKN_SKILL_KEY"
  chk "skill content" skill content "$BKN_SKILL_KEY"
  chk "skill history" skill history "$BKN_SKILL_KEY"
  # `publish-history` is not the history: it publishes a past version, and takes
  # a required `--version`. A write has no place in this file.
else
  echo "SKIP  skill get/names/files/content/history (set BKN_SKILL_KEY)"
fi
chk "toolbox list" toolbox list

echo "### context (MCP)"
# The tool catalog is the contract every other call here is checked against, so
# assert it actually lists tools rather than merely answering.
chk_has "context info" '"(tools|name)"' context info
chk_has "context tools" '"(tools|name)"' context tools "$BKN_KN_ID"
chk "context kn-detail" context kn-detail "$BKN_KN_ID"
chk "context search-schema" context search-schema "$BKN_KN_ID" "team"
# MCP resources/templates/prompts are optional surfaces; a deploy that says so
# is reporting a capability, not an error.
chk_optional "context resources" context resources "$BKN_KN_ID"
chk_optional "context templates" context templates "$BKN_KN_ID"
chk_optional "context prompts" context prompts "$BKN_KN_ID"
# `object-types` / `relation-types` take ids, not a page: `<kn-id> <ids...>`.
# Read one id out of the KN rather than inventing one, and skip when the KN has
# none — an empty knowledge network is a fact about the platform.
if [ -n "$OT_ID" ]; then
  chk_has "context object-types" "$OT_ID" context object-types "$BKN_KN_ID" "$OT_ID"
else
  echo "SKIP  context object-types (no object type in $BKN_KN_ID)"
fi
if [ -n "$RT_ID" ]; then
  chk_has "context relation-types" "$RT_ID" context relation-types "$BKN_KN_ID" "$RT_ID"
else
  echo "SKIP  context relation-types (no relation type in $BKN_KN_ID)"
fi
# These four declare `--args` as a required option; without it commander stops
# the command before it reaches the platform.
if [ -n "$OT_ID" ]; then
  # The MCP tools take `ot_id`, not `object_type_id` — see
  # skills/openbkn/references/context.md. The backend names the field it wants
  # when one is missing, which is how these three were corrected.
  chk "context query-object-instance" context query-object-instance "$BKN_KN_ID" \
    --args "{\"ot_id\":\"$OT_ID\",\"limit\":1}"
  # `_instance_identities` — the leading underscore is the tool's, and the
  # schema says the values must come from a `_instance_identity` field rather
  # than be constructed. Read one out of the network; skip when the type has no
  # instances. `chk_optional` covers the other data-shaped answer: a type with
  # no logic properties defined is a fact about the model, not a failure.
  INST="$(run context query-object-instance "$BKN_KN_ID" --args "{\"ot_id\":\"$OT_ID\",\"limit\":1}" |
    node -e '
      let s = "";
      process.stdin.on("data", (d) => { s += d; });
      process.stdin.on("end", () => {
        try {
          const row = JSON.parse(s)?.result?.datas?.[0];
          process.stdout.write(row?._instance_identity ? JSON.stringify(row._instance_identity) : "");
        } catch {
          process.stdout.write("");
        }
      });
    ')"
  if [ -n "$INST" ]; then
    # `properties` names the logic properties to compute and cannot be empty, so
    # this only runs when the type defines one. `fact` on the reference network
    # defines none, which is what the tool says when asked — a fact about the
    # model, not a defect.
    LP="$(run bkn object-type get "$BKN_KN_ID" "$OT_ID" | node -e '
      let s = "";
      process.stdin.on("data", (d) => { s += d; });
      process.stdin.on("end", () => {
        try {
          const e = JSON.parse(s).entries?.[0] ?? {};
          const list = e.logic_properties ?? e.logicProperties ?? [];
          process.stdout.write(String(list[0]?.name ?? list[0]?.id ?? ""));
        } catch {
          process.stdout.write("");
        }
      });
    ')"
    if [ -n "$LP" ]; then
      chk_optional "context get-logic-properties" context get-logic-properties "$BKN_KN_ID" \
        --args "{\"ot_id\":\"$OT_ID\",\"query\":\"status\",\"_instance_identities\":[$INST],\"properties\":[\"$LP\"]}"
    else
      echo "SKIP  context get-logic-properties (no logic property on $OT_ID)"
    fi
  else
    echo "SKIP  context get-logic-properties (no instance of $OT_ID)"
  fi
  # `query-instance-subgraph` is left out on purpose. Its input is a path
  # template — parallel `object_types` and `relation_types` arrays whose order
  # must correspond, each node carrying a `condition` over a data property that
  # exists on that type. Building one means knowing the model, and a check that
  # hard-codes one network's properties tests that network rather than the CLI.
  # Reach it through `context tool-call query_instance_subgraph` in a suite that
  # owns its fixture.
  echo "SKIP  context query-instance-subgraph (needs a model-specific path template)"
else
  echo "SKIP  context query-object-instance/query-instance-subgraph/get-logic-properties (no object type)"
fi
if [ -n "$AT_ID" ]; then
  chk "context get-action-info" context get-action-info "$BKN_KN_ID" --args "{\"action_type_id\":\"$AT_ID\"}"
else
  echo "SKIP  context get-action-info (no action type in $BKN_KN_ID)"
fi
# The generic entry points every business call goes through. `tools/list` over
# `call-method` and a read-only tool over `tool-call` exercise the managed
# lifecycle — a deploy from 0.1.3 on refuses both without a `bkn_context`, so a
# regression there shows up here and nowhere else in this file.
chk_has "context call-method tools/list" '"(tools|name)"' context call-method "$BKN_KN_ID" tools/list
chk "context tool-call search_schema" context tool-call "$BKN_KN_ID" search_schema --arg query=team
chk "context conversation" context conversation

echo "### conversation reuse"
# `--new-conversation` reports `source: none` by design, so "it ran without
# error" would prove nothing. What it must not do is disturb what is stored —
# compare the stored id across it.
BEFORE="$(run context conversation | grep -oE '"(storedConversationId|conversationId)" *: *"[^"]+"' | head -1)"
run --new-conversation context conversation >/dev/null
AFTER="$(run context conversation | grep -oE '"(storedConversationId|conversationId)" *: *"[^"]+"' | head -1)"
if [ "$BEFORE" = "$AFTER" ]; then
  echo "PASS  --new-conversation leaves the remembered one alone"; pass=$((pass + 1))
else
  echo "FAIL  --new-conversation changed the store :: '$BEFORE' -> '$AFTER'"
  fail=$((fail + 1)); failed+=("--new-conversation side effect")
fi

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

report
