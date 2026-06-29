# agent — decision agents

> ⚠️ **DEPRECATED.** The Decision Agent (`agent-factory`) surface is being phased
> out and may be removed in a future release. Existing commands still work, but
> avoid building new integrations on `openbkn agent …` / `client.agents`. Running
> any `agent` subcommand prints a deprecation warning to stderr.

| Command | Notes |
|---------|-------|
| `list` / `personal-list` / `template-list` / `category-list` | Published / personal / templates / categories. |
| `get <id>` / `get-by-key <key>` / `template-get <id>` | Detail. |
| `create` / `update <id>` / `delete <id>` | `--body`/`--body-file` JSON. |
| `publish <id>` / `unpublish <id>` | Lifecycle. |
| `chat <id> -m "…" [--stream] [--version v0] [--conversation-id <c>]` | Talk to an agent. `--stream` prints tokens live (JSON-patch SSE) + prints the conversation_id. |
| `sessions <agent-key>` / `history <agent-key> <conversation-id>` | Conversations + messages. |
| `trace <conversation-id>` | Fetch the conversation's trace spans (alias of `trace get`). |
| `skill list/add/remove <agent-id> [<skill-ids>]` | Manage skills attached to an agent (config.skills mutation). |

The chat arg is the agent **id** (resolved to id/key/version via agent-market `v0`).
