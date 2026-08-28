# context — MCP retrieval (agent-retrieval)

Layered retrieval over the agent-retrieval MCP endpoint. `<kn-id>` is the first
positional arg on KN-scoped commands — there is no `--kn-id` flag, and the global
`-k` means `--insecure`, not the KN. The MCP endpoint is derived as
`<base-url>/api/agent-retrieval/v1/mcp`.

## Managed business conversation (required)

For a third-party Agent such as Cursor, one Agent chat is one BKN Trace
Conversation, one user question is one Interaction, and every OpenBKN business
tool call is one Operation. Do not call a business tool outside this lifecycle.

**Driving this by hand is for an Agent that owns a real business turn.** The SDK
and CLI open a session of their own when a call would otherwise be rejected for
having no `bkn_context`, so `openbkn context search-schema …` and
`client.context.*` work without any of the steps below. That automatic session
is a fallback, not a replacement: it has no answer to close over, so it is
cancelled rather than completed, and its evidence is attributed to
`openbkn-sdk`. An Agent with a genuine conversation should still run the
lifecycle itself.

A `bkn_context` you build yourself is always honoured — the SDK passes it
through untouched and opens nothing, so a pre-registered `operation_key`,
`parent_operation_id` and `causation_event_ids` survive. That holds for MCP
tool arguments (`client.context.*`, `openbkn context tool-call`) and for the
HTTP retrieval path, where `client.kn.search(kn, q, { bknContext })` takes the
same object. The same holds for
`--conversation-id` / `--interaction-id` (and `BKN_CONVERSATION_ID` /
`BKN_INTERACTION_ID`) on the CLI. Given only a conversation, the SDK opens its
interaction inside that conversation rather than starting a new one.

The CLI remembers a conversation it opened **on a `managed-v2` deploy**, per
platform and active identity, so
consecutive commands continue one thread instead of starting a new one each
time. Only the conversation — every command still opens its own interaction,
since an interaction is one turn and carries a short lease. Precedence:
`--conversation-id` → `BKN_CONVERSATION_ID` → remembered → open a new one.
`--new-conversation` skips the remembered one for a single command;
`openbkn context conversation` shows which is in force and where it came from,
and `--forget` drops it, and `--new-conversation` leaves it in place for later
commands. A transient identity — `--user`, or an explicit `--token` /
`BKN_TOKEN` — neither joins the stored thread nor replaces it: identity here is
the token, while the store is partitioned by the *active* user, who may be
someone else. A script exporting `BKN_TOKEN` therefore opens a conversation per
command, which is the pre-existing behaviour, not a regression — pass
`--conversation-id` (or export `BKN_CONVERSATION_ID`) to tie such a script's
commands together.
A v1 deploy remembers nothing, and `context conversation` reports `none` there:
a v1 interaction cannot be ended early and a conversation permits one at a time,
so a remembered v1 conversation would refuse the next command until its lease
expired. A remembered conversation that can no longer be joined is replaced
rather than reported — the run opens a fresh one and stores that instead.
The SDK writes nothing on its own: persistence is the CLI passing
`onConversationOpened` to `createClient`, and a conversation it may replace
travels as `rememberedConversationId`, not as `trace.conversationId`.

1. For the first business question in a chat, call `bkn_start_interaction` with
   the complete `question`, optional display-only `agent_name`, and no
   `conversation_id`. Context Loader creates or
   resolves the managed Conversation internally and returns the authoritative
   `conversation_id` and `interaction_id`. The name is fixed for that
   Conversation; later turns omit it or repeat the same value.
2. For every later question in the same chat, call `bkn_start_interaction` with
   the complete question and the previously returned `conversation_id`. Retain
   both returned IDs exactly as provided. A Conversation may stay active across
   turns, reconnects, and days.
3. Call each business tool with:

   ```json
   {
     "bkn_context": {
       "conversation_id": "conv_...",
       "interaction_id": "int_..."
     }
   }
   ```

   Do not add guessed operation or business-reference fields. Context Loader
   observes the selected knowledge network, schema and data resources from the
   authoritative request and response, and returns the authoritative
   `bkn_receipt`.
4. After forming the final answer, call `bkn_finish_interaction` with the
   `interaction_id`, `outcome: "completed"`, and the exact final answer. This
   submits the current Interaction result; it does not close the Conversation.
   Use `failed`, `cancelled`, or `handed_off` with a reason when applicable.
   OpenBKN manages leases, idempotency, Operation/Receipt closure, and the
   result Artifact.
5. Do not start the next Interaction until the current one is terminal. Do not
   use raw `openbkn call`, direct ontology-query, or direct Vega calls as a
   substitute for managed Context Loader tools when business provenance is
   required.

Tool input schemas returned by MCP are authoritative. When a lifecycle call is
rejected, stop before any business query, surface the original error, and follow
its `required_action`. Never invent IDs, retry the business operation blindly,
or silently fall back to raw CLI, ontology-query, or Vega calls; those paths
cannot produce a complete managed business conversation.

The MCP connection itself must carry a trusted tenant identity. For an
AppKey-based local Cursor connection, configure `Authorization`; the platform
resolves and verifies the tenant boundary. Missing tenant context is an
authorization configuration error, not a reason to bypass the managed lifecycle.

A host adapter may attach an opaque host conversation key and a per-call client
invocation ID using `X-OpenBKN-Host-Conversation-Key` /
`X-OpenBKN-Client-Invocation-Id`, or the corresponding
`openbkn.ai/host-conversation-key` / `openbkn.ai/client-invocation-id` MCP
metadata. These are adapter hints for continuity and retry idempotency inside the already
authenticated owner scope; they are not model arguments and never establish
tenant, user, application, or data permissions. A generic MCP
client needs only to retain and reuse the returned `conversation_id`. MCP
transport session IDs are not business Conversation IDs.

The TypeScript SDK exposes these hints as an optional fourth argument to
`context.toolCall` / `context.managedToolCall`; the SDK writes them to MCP
`_meta`, never to the model-visible tool arguments:

```ts
await client.context.toolCall(
  knId,
  "bkn_start_interaction",
  {
    question,
    ...(conversationId ? { conversation_id: conversationId } : { agent_name: agentName }),
  },
  {
    hostConversationKey: hostChatId,
    clientInvocationId: hostTurnId,
  },
);
```

Reuse `clientInvocationId` only when retrying the same start call. Generate a
new value for the next user turn.

Do not fabricate internal headers such as `bkn-event-observed-at`. Third-party
Agents propagate only the two returned IDs; host adapters may supply their
opaque continuity hints outside the model-visible schema. Trusted OpenBKN
services derive operation identity, concurrency, closure, and lifecycle
timestamps from Core resources.

## Discover first

| Command | Notes |
| --- | --- |
| `info` | The deploy's full MCP tool catalog — **no KN needed**. Best first step. Table by default; `--json` shows each tool's `inputSchema`. |
| `tools <kn>` | Same catalog, scoped to a KN session. |

The `inputSchema` from `info`/`tools` is the source of truth for a tool's
argument names. Anything below is the common shape; verify against `info`.

## Calling — generic (works for any tool, current or future)

```bash
# discover → call
openbkn context info
openbkn context tool-call <kn> <tool-name> --args '{"k":"v"}'
openbkn context tool-call <kn> <tool-name> --arg k=v --arg n=10 --arg list='["a","b"]'
#   --arg repeats; each value is parsed as JSON (number/bool/array), else a string
```

`call-method <kn> <method>` does the same for raw MCP protocol methods
(`tools/list`, `resources/read`, `prompts/get`, …) that have no dedicated
command.

## Progressive schema disclosure (get_kn_detail + drill-down)

A KN's full schema is heavy (a 27-object / 37-relation KN is ~143 KB). Read the
**skeleton first, then drill into what you need** — don't pull `full` up front.

| Command | Notes |
| --- | --- |
| `kn-detail <kn> [--detail-level summary\|full]` | KN schema. **`summary` (default)** = skeleton + per-property `name/display_name/type/comment` only (drops field mappings, query operators, logic-property sources, relation `mapping_rules`; dedups concept groups). `full` = everything (still deduped). |
| `object-types <kn> <ids...>` | Full definitions for the named object-type ids. Ids with no match come back under `missing`. |
| `relation-types <kn> <ids...>` | Full definitions for the named relation-type ids (incl. `mapping_rules`); unmatched → `missing`. |

```bash
# 1. skeleton — cheap, get the shape + ids
openbkn context kn-detail worldcup_vega_catalog_bkn
# 2. drill into the objects you care about (bad ids echo back in `missing`)
openbkn context object-types worldcup_vega_catalog_bkn matches goals
# 3. relation details on demand
openbkn context relation-types worldcup_vega_catalog_bkn rel_award_winners_award
```

> `object-types` / `relation-types` send `ids` as a real array — prefer them over
> `tool-call get_object_types --arg ids=a,b`, which the server rejects (a bare
> comma string is not a JSON array).

## Named commands + argument shapes

### Schema discovery

```bash
openbkn context search-schema <kn> "customer churn" --scope object,relation --max 10
```

Flag mapping → MCP `search_schema`: `<query>` → `query`, `--scope a,b` →
`search_scope: ["a","b"]`, `--max n` → `max_concepts`. Always sends
`response_format: "json"`.

### Instance query — `--args <json>`

```bash
# query-object-instance: ot_id + structured condition (NOT SQL). Keep limit small.
openbkn context query-object-instance <kn> --args '{
  "ot_id": "ot-1",
  "condition": {"operation": "and", "sub_conditions": [
    {"field": "name", "operation": "==", "value_from": "const", "value": "web-pod"}
  ]},
  "limit": 5
}'

# query-instance-subgraph: relation-type paths from a start object type
openbkn context query-instance-subgraph <kn> --args '{
  "relation_type_paths": [
    {"start_ot_id": "ot-1", "paths": [{"rt_id": "rt-1", "direction": "positive"}]}
  ]
}'
```

### Instance enrichment / actions — `--args <json>`

```bash
# get-logic-properties: computed property values for given instances
openbkn context get-logic-properties <kn> --args '{
  "ot_id": "ot-1", "query": "status",
  "_instance_identities": [{"id": "123"}],
  "properties": ["status", "cpu"]
}'

# get-action-info: action metadata / dynamic tools for one instance
openbkn context get-action-info <kn> --args '{"at_id": "at-1", "_instance_identity": {"id": "123"}}'
```

### Skill recall

```bash
openbkn context find-skills <kn> <object-type-id> --top-k 5
```

`<object-type-id>` → `object_type_id`, `--top-k n` → `top_k` (1–20). For the
richer args (skill_query, instance_identities) use the generic path:
`tool-call <kn> find_skills --args '{"object_type_id":"ot_drug","skill_query":"treatment","top_k":5}'`.

### Standard MCP resources & prompts

```bash
openbkn context resources <kn>
openbkn context resource <kn> <uri>
openbkn context templates <kn>
openbkn context prompts <kn>
openbkn context prompt <kn> <name> --args '{...}'
```

## Notes

- Discovery model: **tools are dynamic** (`info`/`tools` — new server tools
  appear with no CLI change, call them via `tool-call`); **MCP methods are
  protocol-fixed**, not listable, reachable via `call-method`.
- `resources`/`prompts` may report "not supported" if the deploy's MCP server
  doesn't advertise those capabilities.
- Output: `info`/`tools` render a `name + description` table; every command
  takes `--json` / `--compact` for the full machine-readable payload.
