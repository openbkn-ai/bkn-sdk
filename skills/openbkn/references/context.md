# context — MCP retrieval (agent-retrieval)

| Command | Notes |
|---------|-------|
| `search-schema <kn> <query> [--scope a,b] [--max n]` | Schema discovery. |
| `query-object-instance <kn> --args <json>` | Instance query (use `condition` + small `limit`). |
| `find-skills <kn> <object-type-id> [--top-k]` | Skill recall. |
| `tools <kn>` / `tool-call <kn> <name> --args <json>` | List / call any MCP tool. |
| `resources/resource/templates/prompts/prompt <kn>` | Standard MCP resource & prompt methods. |
| `query-instance-subgraph` / `get-logic-properties` / `get-action-info <kn> --args <json>` | Layer-2/3 tools. |

`resources`/`prompts` may report "not supported" if the deploy's MCP server doesn't advertise those capabilities.
