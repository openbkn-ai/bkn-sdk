# context — MCP retrieval (agent-retrieval)

Layered retrieval over the agent-retrieval MCP endpoint (JSON-RPC over
Streamable HTTP). `<kn-id>` is the first positional arg on KN-scoped commands
(it becomes the `x-kn-id` header); the endpoint is
`<base-url>/api/agent-retrieval/v1/mcp`.

> All examples below were verified against a live deploy's `context info --json`.
> Tool schemas are **server-defined** — re-check `context info --json` if a deploy
> differs.

## Discover first

| Command | KN? | Notes |
| --- | :---: | --- |
| `info` | no | Global MCP tool catalog (`GET …/mcp/info`). **Best first step.** Default = `name + description` table; `--json` adds each tool's `input_schema` / `output_schema`, the endpoint, and the auth note. |
| `tools <kn>` | yes | The catalog scoped to a KN session (`tools/list`). |

**Tools are dynamic** — a deploy can add tools with no CLI change; discover them
here and call via `tool-call`. **MCP methods** (`tools/list`, `resources/read`,
…) are protocol-fixed, reachable via `call-method`.

`-k` is `--insecure` (TLS), **not** a KN selector. There is no `--kn-id` flag —
the KN is the positional arg.

## The 9 tools (live deploy)

| Tool | CLI | Required args | Notes |
| --- | --- | --- | --- |
| `search_schema` | `search-schema` | `query` | Schema discovery → object/relation/action/metric types. |
| `query_object_instance` | `query-object-instance` | `ot_id` | Filter instances of one object type. |
| `query_instance_subgraph` | `query-instance-subgraph` | `relation_type_paths` | Multi-hop relation traversal. |
| `get_logic_properties_values` | `get-logic-properties` | `ot_id`,`query`,`_instance_identities`,`properties` | Compute metric/operator values for instances. |
| `get_action_info` | `get-action-info` | `at_id` | Executable action tool-defs for instances. |
| `find_skills` | `find-skills` | `object_type_id` | Recall skills for an object type. |
| `list_knowledge_networks` | *(tool-call)* | — | List KNs (kn_id/name/desc). **Entry point when you don't know the kn_id.** |
| `get_kn_detail` | *(tool-call)* | `kn_id` | Full KN schema in one call (concept groups, object/relation/action types incl. `data_source.id`). |
| `run_sql` | *(tool-call)* | `sql` | Read-only **Trino** SQL over the KN's mounted resources. |

Tools without a named CLI command (`list_knowledge_networks`, `get_kn_detail`,
`run_sql`) are first-class — call them generically:

```bash
openbkn context tool-call <kn> list_knowledge_networks --arg response_format=json
openbkn context tool-call <kn> get_kn_detail --arg response_format=json
```

## `response_format`: every tool defaults to `toon`

Every tool takes `response_format` with enum `json | toon`, **default `toon`**
(a compact text format, not JSON). Through the generic `tool-call` path you get
`toon` unless you pass `--arg response_format=json`. The named `search-schema`
command forces `json`; the other named wrappers do **not** — pass
`--arg response_format=json` (or use `--args`) when you want JSON.

## Generic calling

```bash
openbkn context tool-call <kn> <tool> --args '{"k":"v"}'
openbkn context tool-call <kn> <tool> --arg k=v --arg n=10 --arg list='["a","b"]'
#   --arg repeats; each value is JSON-parsed (number/bool/array), else a string
openbkn context call-method <kn> <method>          # raw MCP method (tools/list, resources/read…)
```

## Tool argument shapes (from the live input_schema)

### search_schema  → `search-schema <kn> <query> [--scope a,b] [--max n]`

| Field | Required | Default | Notes |
| --- | :---: | --- | --- |
| `query` | ✅ | — | Keywords (space-separated). |
| `search_scope` | optional | all four on | **An OBJECT**: `{include_object_types, include_relation_types, include_action_types, include_metric_types}` (booleans) + `concept_groups: []` (BKN group ids to limit recall). |
| `max_concepts` | optional | 10 | ≥1. Candidate cap. |
| `schema_brief` | optional | false | true → trimmed schema. |
| `enable_rerank` | optional | true | Rerank relation types. |

> **CLI caveat:** `search-schema --scope a,b` sends `search_scope` as a string
> **array** `["a","b"]`, but the server expects the **object** above — so
> `--scope` likely does nothing useful. To scope reliably, use the generic path:
> `tool-call <kn> search_schema --args '{"query":"...","search_scope":{"include_object_types":true,"include_relation_types":false}}'`.
> A bad `concept_groups` id returns a 5xx (`all concept group not found`), not an
> empty result.

### query_object_instance  → `query-object-instance <kn> --args <json>`

| Field | Required | Default | Notes |
| --- | :---: | --- | --- |
| `ot_id` | ✅ | — | Object type id (from `search_schema` / `get_kn_detail`). |
| `condition` | optional | — | Nested filter: `{field, operation, value_from, value}` joined by `{operation:"and"\|"or", sub_conditions:[…]}`. NOT SQL. |
| `limit` | optional | 10 | 1–10000. |
| `search_after` | optional | — | Cursor (object-index / data-view sources). Pass the prior response's `search_after`; forward-only. First call: omit. |
| `offset` | optional | — | Offset paging (resource / vega-table sources). **Mutually exclusive** with `search_after` (cursor wins). |
| `properties` | optional | all | Project specific fields. |
| `include_logic_params` | optional | — | Return logic-property calc params. |

```bash
openbkn context query-object-instance <kn> --args '{
  "ot_id": "ot-1",
  "condition": {"operation":"and","sub_conditions":[
    {"field":"name","operation":"==","value_from":"const","value":"web-pod"}]},
  "limit": 5
}'
```

### query_instance_subgraph  → `query-instance-subgraph <kn> --args <json>`

`relation_type_paths` (required): path templates where `object_types` and
`relation_types` arrays must line up — an **n-hop path = n+1 `object_types` and
n `relation_types`**, in order.

```bash
openbkn context query-instance-subgraph <kn> --args '{
  "relation_type_paths": [
    {"object_types": ["ot-1","ot-2"], "relation_types": ["rt-1"]}
  ]
}'
```

### get_logic_properties_values  → `get-logic-properties <kn> --args <json>`

Required: `ot_id`, `query` (must carry time/aggregation/business context),
`_instance_identities`, `properties` (logic-property names that exist in the
schema). Optional: `additional_context` (timezone/instant/step), `llm_model`.

```bash
openbkn context get-logic-properties <kn> --args '{
  "ot_id":"ot-1","query":"status in the last 7 days",
  "_instance_identities":[{"id":"123"}],
  "properties":["status","cpu"]
}'
```

### get_action_info  → `get-action-info <kn> --args <json>`

Required `at_id`. Optional `_instance_identities` (array, **plural**).

> `_instance_identities` **must be copied verbatim** from the `_instance_identity`
> field of a prior `query_object_instance` / `query_instance_subgraph` result —
> do not hand-build them.

### find_skills  → `find-skills <kn> <object-type-id> [--top-k n]`

`object_type_id` (required), `skill_query` (semantic filter), `top_k` (1–20,
default 10), `instance_identities` (narrow to instances). The CLI maps only
`<object-type-id>` and `--top-k`; for `skill_query` / `instance_identities` use
`tool-call <kn> find_skills --args '{…}'`.

### run_sql  (Trino SQL — `tool-call <kn> run_sql`)

Read-only SQL over the KN's mounted data resources. **Distinct from top-level
`vega sql`** (see vega.md): this is KN-scoped, **Trino dialect**, and
`resource_type` is auto-resolved.

| Field | Required | Default | Notes |
| --- | :---: | --- | --- |
| `sql` | ✅ | — | **Trino** dialect. **`SELECT`/`WITH` only** — no writes, no DDL, no multi-statement, no cross-catalog joins. Tables = `{{.resource_id}}` (**leading dot**); `resource_id` = the object type's `data_source.id`. vega caps at 10000 rows. |
| `resource_type` | optional | auto | `mysql`/`mariadb`/`postgresql`. Auto-resolved from the first `{{.resource_id}}` — usually omit. |
| `query_timeout` | optional | 60 | Seconds, 1–3600. |

```bash
openbkn context tool-call <kn> run_sql --args '{
  "sql":"SELECT * FROM {{.<data-source-id>}} LIMIT 10","response_format":"json"
}'
```

## Standard MCP resources & prompts

```bash
openbkn context resources <kn>        # resources/list
openbkn context resource <kn> <uri>   # resources/read
openbkn context templates <kn>        # resources/templates/list
openbkn context prompts <kn>          # prompts/list
openbkn context prompt <kn> <name> --args '{...}'   # prompts/get
```

## Gotchas → fix

| Symptom | Fix |
| --- | --- |
| Don't know the `kn_id` | `tool-call <kn-or-any> list_knowledge_networks` — or it's the first positional arg / `x-kn-id`. |
| Result is dense text, not JSON | Default `response_format` is `toon`. Pass `--arg response_format=json` (or `search-schema`, which forces json). |
| `--scope` on search-schema seems ignored | Known CLI shape mismatch (array vs object). Use `tool-call search_schema --args` with the object `search_scope`. |
| `search_schema` 5xx "all concept group not found" | A `concept_groups` id doesn't exist in this KN — not an empty result. |
| `get-logic-properties` / `get-action-info` return nothing | `_instance_identities` must be copied verbatim from a prior query's `_instance_identity`, not invented. Run `query_object_instance` first. |
| `run_sql` rejected | `SELECT`/`WITH` only; no DDL/writes/multi-statement; no cross-catalog joins; tables must be `{{.resource_id}}` (**leading dot**), id = object type's `data_source.id`. |
| `info` shows an unfamiliar tool | Tools are dynamic. Read its `input_schema` from `info --json`, call with `tool-call <kn> <name> --args '{…}'` — no wrapper needed. |
| `resources`/`prompts` say "not supported" | The deploy's MCP server doesn't advertise that capability. |
