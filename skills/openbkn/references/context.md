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
interaction inside that conversation rather than starting a new one. Given only
an interaction, it uses the automatic lifecycle handshake; after a context is
opened it does not forward the orphan interaction
as a business header, and it never guesses a Conversation ID locally. Treat the returned
Receipt, not the supplied interaction alone, as the authoritative context.

A complete caller-owned `bkn_context` does not require a lifecycle catalog
probe: the caller has already asserted the business pair. A receipt-requested
call still requires the server to return and validate its Receipt; catalog
unavailability is not an authorization bypass.

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

The MCP connection itself must carry trusted authentication. For an AppKey-based
local Cursor connection, configure `Authorization`; the platform resolves and
verifies the caller identity and grants. Missing authentication is a configuration
error, not a reason to bypass the managed lifecycle.

A host adapter may attach an opaque host conversation key and a per-call client
invocation ID using `X-OpenBKN-Host-Conversation-Key` /
`X-OpenBKN-Client-Invocation-Id`, or the corresponding
`openbkn.ai/host-conversation-key` / `openbkn.ai/client-invocation-id` MCP
metadata. These are adapter hints for continuity and retry idempotency inside the already
authenticated owner scope; they are not model arguments and never establish
user, application, or data permissions. A generic MCP
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

需要把业务结果与本次操作的证据一起交给自动化程序时，显式请求 Receipt：

```bash
openbkn --json context tool-call <kn> <tool-name> --args '{"k":"v"}' --receipt
# → { "value": ..., "bkn_receipt": { "receipt_status": "completed", "evidence_durability": ..., "observed_evidence_refs": [...], "business_refs": [...] } }
```

`--receipt` 必须配合 `--json` 或 `--compact`，不能与 `--schema` 一起使用。
默认 `tool-call` 输出不变，只返回业务值。SDK 对 Receipt 的必要字段和状态作本地校验，
但这只说明它与当前调用匹配（validated）；若需确认当前身份仍有权限读取该证据，应使用
`openbkn trace receipts get <receipt-id>` 回读（authorized）。Receipt 不是凭据，勿写入日志、
指标标签或后续工具参数。

`value: null` 本身不是状态：`pending` Receipt 的 value 不可消费，必须依据
`bkn_receipt.receipt_status` 判断，并使用 `receipt_id` 回读；不得通过重试业务工具取得结果。
0.1.5 平台上 `completed` 回执只带状态、证据持久性与证据/业务引用（有 `partial_reasons` 时一并带上），
`receipt_id` 等身份字段只随 `pending` 与终态重放回执返回；完整记录留在 BKN Trace。
在 catalog 明确不支持 lifecycle 的部署上，`--receipt` 仍会执行一次业务调用，但若服务端不返回
Receipt，命令以 `receipt_missing` 失败，业务副作用不会被回滚。

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

### Cypher across object types — `run-cypher`

When the question can be stated in object types and relation types — filter along a
path, aggregate what it reaches — write it as read-only Cypher. Everything is named
the way the model names it: labels are object type ids or names, relationship types
are relation type ids or names, properties are logical property names. No resource
id, no physical column; bkn-backend works out the joins from the relation types.

```bash
openbkn context run-cypher <kn> \
  --query "MATCH (c:customer)<-[:rel_order_customer]-(o:order)
           WHERE o.amount > \$floor
           RETURN c.city AS city, count(*) AS orders ORDER BY orders DESC LIMIT 20" \
  --params '{"floor": 100}'
# → { "columns": [{"name": "city", "type": "string"}, ...], "entries": [{"city": ..., "orders": ...}] }
```

- Supported: several `MATCH` clauses and comma-separated paths (a repeated variable is
  the same node); `-[:R]->`, `<-[:R]-`, undirected `-[:R]-`; `WHERE` with comparisons,
  `IN`, `IS NULL`, `AND`/`OR`/`NOT`; `RETURN` with `AS`, `DISTINCT` and
  `count`/`sum`/`avg`/`min`/`max` — aggregating groups by the other returned columns;
  `ORDER BY`, `SKIP`, `LIMIT`.
- Refused, naming the construct and its position: `OPTIONAL MATCH`, `WITH`, `UNION`,
  variable-length paths `[:R*1..3]`, functions and arithmetic, returning a whole node
  (`RETURN n` — return its properties instead), relationship variables `-[r:R]->`.
- Limits: at most 8 relationships and 9 nodes per query; 1000 rows without `LIMIT`;
  `LIMIT` above 10000 is refused.
- `--params` is a JSON object of values. A parameter never becomes a label, relationship
  type or property name. Quote `$name` in the shell (`\$floor` inside double quotes).
- Fall back to `run-sql` only for what the subset cannot express (CTEs, `UNION`, window
  functions) or for resources never modelled as object types.
- `openbkn bkn cypher <kn> --query ...` runs the same statement outside any Trace session.

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

### Capability search

One ranking over every kind the network mounted — skills, functions, API tools
and MCP tools — so "what can do this?" is one call, not one per kind.

```bash
openbkn context search-capabilities <kn> --query "treatment" --limit 5
openbkn context search-capabilities <kn> --types skill
openbkn context search-capabilities <kn> --types function --metadata-types openapi
```

Each hit carries `capability_type`, which decides what comes next: `function`
and `mcp_tool` are called through `execute_tool` with the returned
`input_schema`, `skill` is read with `get_skill_content` and run with
`execute_skill`. Omit `--query` to list what is mounted, in mount order.

Replaces `find-skills` and the tool-only search, removed in bkn-foundry#1401.

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
