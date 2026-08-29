# toolbox / tool — agent toolboxes + tools

| Command | Notes |
|---------|-------|
| `toolbox list [--keyword] [--limit]` | List toolboxes. |
| `toolbox create --name <n> [--type openapi\|function] [--service-url <url>] [--description]` | Create. `openapi` 箱子代理到 `--service-url`（必填）；`function` 箱子装平台函数，不填服务地址。 |
| `toolbox publish <id>` / `unpublish <id>` / `delete <id>` | Lifecycle。**发布只影响市场可见性，不卡执行**——箱子 `unpublish` 时，已 enable 的工具照样能 `tool execute`。 |
| `toolbox export <id> -o box.adp [--type toolbox|mcp|operator]` | Export config (impex, raw bytes). |
| `toolbox import <file> [--type …]` | Import an exported `.adp` (multipart). |
| `tool create <file> --toolbox <id> --name <n> --description <d> [--inputs/--outputs '<json>'] [--type openapi]` | 在箱子里直接建工具。**唯一能建函数工具的命令**；`--type openapi` 时 `<file>` 是 spec（JSON 或 YAML）。批量返回 `success_ids` / `failure_count`，**部分失败也是 200**，命令会以非零退出码反映。 |
| `tool get <tool-id> --toolbox <id>` | 工具详情。 |
| `tool update <tool-id> <file> --toolbox <id> --name <n> --description <d>` | 整体覆盖（`name`/`description` 必填）。`tool_id` 不变，生成新 metadata version，已启用的工具不用重新启用。 |
| `tool delete <tool-ids...> --toolbox <id>` | 批量删除。 |
| `tool upload <openapi-file> --toolbox <id> [--metadata-type openapi]` | 同一端点的 multipart 形态：把 spec 文件直接传上去，服务端自己解析。 |
| `tool list --toolbox <id> [--limit n] [--page n] [--all]` / `tool enable\|disable <tool-ids...> --toolbox <id>` | List / enable-disable. `tool list` backend defaults to 10; `--all` returns every tool. |
| `tool execute\|debug <tool-id> --toolbox <id> [--header/--query/--path/--body JSON]` | 调用（`debug` 不受 enabled 限制）。**函数工具的返回套两层**：结果在 `body.result`。 |

算子转成的工具见 [function-operator.md](function-operator.md)。
