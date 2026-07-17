# context — MCP retrieval (agent-retrieval)

Layered retrieval over the agent-retrieval MCP endpoint. `<kn-id>` is the first
positional arg on KN-scoped commands — there is no `--kn-id` flag, and the global
`-k` means `--insecure`, not the KN. The MCP endpoint is derived as
`<base-url>/api/agent-retrieval/v1/mcp`.

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
