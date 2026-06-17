# context — MCP retrieval (agent-retrieval)

| Command | Notes |
|---------|-------|
| `search-schema <kn> <query> [--scope a,b] [--max n]` | Schema discovery. |
| `query-object-instance <kn> --args <json>` | Instance query (use `condition` + small `limit`). |
| `find-skills <kn> <object-type-id> [--top-k]` | Skill recall. |
| `info` | The deploy's full MCP tool catalog — **no KN needed**. Best first step to see what tools exist. |
| `tools <kn>` | List MCP tools advertised for a KN session (same catalog, scoped; with input schemas). |
| `tool-call <kn> <name> [--args <json>] [--arg k=v ...]` | Call any tool by name. `--arg` repeats; each value is parsed as JSON (numbers/bools/arrays), else kept as a string. Use this for tools without a named wrapper. |
| `call-method <kn> <method> [--args <json>] [--arg k=v ...]` | Call any MCP method by name (e.g. `tools/list`, `resources/read`) — escape hatch for protocol methods without a dedicated command. |
| `resources/resource/templates/prompts/prompt <kn>` | Standard MCP resource & prompt methods. |
| `query-instance-subgraph` / `get-logic-properties` / `get-action-info <kn> --args <json>` | Subgraph query, logic-property values, action info. |

Discovery: tools are dynamic — run `tools <kn>` to see what a deploy exposes (and the args each takes). MCP *methods* are protocol-fixed, not listable. New server tools need no CLI change — call them via `tool-call`.

`resources`/`prompts` may report "not supported" if the deploy's MCP server doesn't advertise those capabilities.
