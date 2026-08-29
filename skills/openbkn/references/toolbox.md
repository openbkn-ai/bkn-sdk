# toolbox / tool — agent toolboxes + tools

| Command | Notes |
|---------|-------|
| `toolbox list [--keyword] [--limit]` | List toolboxes. |
| `toolbox create --name <n> [--type openapi\|function] [--service-url <url>] [--description]` | Create. `openapi` 箱子代理到 `--service-url`（必填）；`function` 箱子装平台函数，不填服务地址。 |
| `toolbox publish <id>` / `unpublish <id>` / `delete <id>` | Lifecycle. |
| `toolbox export <id> -o box.adp [--type toolbox|mcp|operator]` | Export config (impex, raw bytes). |
| `toolbox import <file> [--type …]` | Import an exported `.adp` (multipart). |
| `tool upload <openapi-file> --toolbox <id> [--metadata-type openapi]` | Upload a tool spec. |
| `tool list --toolbox <id> [--limit n] [--page n] [--all]` / `tool enable\|disable <tool-ids...> --toolbox <id>` | List / enable-disable. `tool list` backend defaults to 10; `--all` returns every tool. |
| `tool execute|debug <tool-id> --toolbox <id> [--header/--query/--path/--body JSON]` | Invoke (debug bypasses the enabled gate). |

算子转成的工具见 [function-operator.md](function-operator.md)。
