# context — MCP retrieval (agent-retrieval)

Layered retrieval over the agent-retrieval MCP endpoint. `<kn-id>` is the first
positional arg on KN-scoped commands (or the global `-k`/`--kn-id`); the MCP
endpoint is derived as `<base-url>/api/agent-retrieval/v1/mcp`.

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
openbkn context info -k
openbkn context tool-call <kn> <tool-name> --args '{"k":"v"}'
openbkn context tool-call <kn> <tool-name> --arg k=v --arg n=10 --arg list='["a","b"]'
#   --arg repeats; each value is parsed as JSON (number/bool/array), else a string
```

`call-method <kn> <method>` does the same for raw MCP protocol methods
(`tools/list`, `resources/read`, `prompts/get`, …) that have no dedicated
command.

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
