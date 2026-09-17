# toolbox / tool — agent toolboxes + tools

| Command | Notes |
|---------|-------|
| `toolbox list [--name] [--status unpublish\|published\|offline] [--category] [--metadata-type openapi\|function] [--create-user] [--release-user] [--sort-by create_time\|update_time\|name] [--sort-order asc\|desc] [--limit n] [--page n] [--all]` | List toolboxes. 分页是 `--page`（从 1 起）+ `--limit`（即 `page_size`，1–100，默认 30）；服务端没有 offset。`--keyword` 仍作为 `--name` 的别名可用。 |
| `toolbox create --name <n> [--type openapi\|function] [--service-url <url>] [--description]` | Create. `openapi` 箱子代理到 `--service-url`（必填）；`function` 箱子装平台函数，不填服务地址。 |
| `toolbox publish <id>` / `unpublish <id>` / `delete <id>` | Lifecycle。`unpublish` 发送 `status=offline`（下架；工具箱只有 `unpublish` / `published` / `offline` 三态，没有 `draft`）。**执行要求箱子处于 `published`**：箱子 `offline`（或未发布）时 `tool execute` 返回 400 `ToolNotAvailable`，开发阶段用 `tool debug`。 |
| `toolbox export <id> -o box.adp [--type toolbox|mcp|operator]` | Export config (impex, raw bytes). |
| `toolbox import <file> [--type …] [--mode create\|upsert]` | Import an exported `.adp` (multipart). `--mode` 缺省由服务端按 `create` 处理：组件已存在返回 409 `CommonResourceIDConflict`；`upsert` 则原地更新已有的（不会产生重复箱子）。 |
| `tool create <file> --toolbox <id> --name <n> --description <d> [--inputs/--outputs '<json>'] [--type openapi]` | 在箱子里直接建工具。**唯一能建函数工具的命令**；`--type openapi` 时 `<file>` 是 spec（JSON 或 YAML）。批量返回 `success_ids` / `failure_count`，**部分失败也是 200**，命令会以非零退出码反映。 |
| `tool get <tool-id> --toolbox <id>` | 工具详情。 |
| `tool update <tool-id> <file> --toolbox <id> --name <n> --description <d>` | 整体覆盖（`name`/`description` 必填）。`tool_id` 不变，生成新 metadata version，已启用的工具不用重新启用。 |
| `tool delete <tool-ids...> --toolbox <id>` | 批量删除。 |
| `tool upload <openapi-file> --toolbox <id> [--metadata-type openapi]` | 同一端点的 multipart 形态：把 spec 文件直接传上去，服务端自己解析。 |
| `tool list --toolbox <id> [--name] [--status enabled\|disabled] [--sort-by create_time\|update_time\|tool_name] [--sort-order asc\|desc] [--user-id] [--limit n] [--page n] [--all]` / `tool enable\|disable <tool-ids...> --toolbox <id>` | List / enable-disable. `tool list` backend defaults to 10 (max 100); `--all` returns every tool. |
| `tool execute\|debug <tool-id> --toolbox <id> [--header/--query/--path/--body JSON] [--timeout <s>]` | 调用（`debug` 不受 enabled 限制）。客户端按 `--timeout` 加余量等待；不给时按沙箱上限（3600s）等。**注意**：经工具箱代理调用函数工具时，平台对内部函数执行目前有约 30s 上限，`--timeout` 调不高；超时会以 200 + `body.result: null` 返回。需要长跑的函数用 `function run`。信封里 `status_code` ≥ 400 或带 `error` 时 CLI 以非 0 退出。**函数工具的返回套两层**：结果在 `body.result`。 |

函数工具的代码怎么写见 [function.md](function.md)。
