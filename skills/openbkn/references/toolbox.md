# toolbox / api / tool — 工具箱与持久能力

| Command | Notes |
|---------|-------|
| `toolbox list [--name] [--status unpublish\|published\|offline] [--category] [--metadata-type openapi\|function] [--create-user] [--release-user] [--sort-by create_time\|update_time\|name] [--sort-order asc\|desc] [--limit n] [--page n] [--all]` | List toolboxes. 分页是 `--page`（从 1 起）+ `--limit`（即 `page_size`，1–100）；CLI 不给 `--limit` 时发 30，SDK `toolboxes.list()` 不传 `pageSize` 时服务端默认 10；服务端没有 offset。`--keyword` 仍作为 `--name` 的别名可用。 |
| `toolbox create --name <n> [--type openapi\|function] [--service-url <url>] [--description] [--category <c>]` | Create（`--category` 即 `box_category`，缺省 `other_category`）。 `openapi` 箱子代理到 `--service-url`（必填）；`function` 箱子装平台函数，不填服务地址。 |
| `toolbox publish <id>` / `unpublish <id>` / `delete <id>` | 生命周期。`unpublish` 发送 `status=offline`（下架；工具箱只有 `unpublish` / `published` / `offline` 三态，没有 `draft`）。**`execute` 要求箱子已 `published`**：未发布或已下线的箱子返回 400 `ToolNotAvailable`；`debug` 发布前就能用。 |
| `toolbox export <id> -o box.adp [--type toolbox\|mcp\|operator]` | 导出整箱配置（impex，原始字节）。`--type` 只收这三个值，其他值 CLI 直接拒绝（服务端会 400）。 |
| `toolbox import <file> [--type toolbox\|mcp\|operator] [--mode create\|upsert]` | 导入 `.adp`（multipart）。`--mode` 缺省由服务端按 `create` 处理：组件已存在返回 409 `CommonResourceIDConflict`；`upsert` 则原地更新已有的（不会产生重复箱子）。 |
| `api import <openapi-file> --toolbox <id>` | 从 JSON 或 YAML 规范导入 OpenAPI Tools。一个规范可产生多个操作；`failure_count` 非零时命令以非零退出。 |
| `api list\|get\|update\|delete\|enable\|disable\|execute\|debug … --toolbox <id>` | 管理和执行已注册的 OpenAPI Tools。`list`、`execute`/`debug` 的参数与下面的 `tool list`、`tool execute\|debug` 相同。 |
| `function create\|list\|get\|update\|delete\|enable\|disable\|execute\|debug … --toolbox <id>` | 管理和执行已注册的 Function Tools（见 [function.md](function.md)）。函数代码试跑用 `sandbox`。 |
| `tool …` | 高级、类型无关的 Toolbox/Tool 入口，兼容已有自动化；`tool create --type openapi` 和 `tool upload` 保留。 |
| `tool create <file> --toolbox <id> --name <n> --description <d> [--inputs/--outputs '<json>'] [--type openapi] [--use-rule] [--global-parameter '<json>'] [--extend-info '<json>']` | 在箱子里直接建工具；`--global-parameter` 是**单个对象** `{name,description,in,type,required?,value?}`，不是数组（`api import` / `function create` 及各自的 `update` 同样接受这三个参数）；`--type openapi` 时 `<file>` 是 spec（JSON 或 YAML）。批量返回 `success_ids` / `failure_count`，**部分失败也是 200**，命令会以非零退出码反映。 |
| `tool get <tool-id> --toolbox <id>` | 工具详情。 |
| `tool update <tool-id> <file> --toolbox <id> --name <n> --description <d>` | 整体覆盖（`name`/`description` 必填，放在顶层；函数定义按编辑形态发送，不含 name/description）。`tool_id` 不变，生成新 metadata version，已启用的工具不用重新启用。 |
| `tool delete <tool-ids...> --toolbox <id>` | 批量删除。 |
| `tool upload <openapi-file> --toolbox <id> [--metadata-type openapi\|function]` | 同一端点的 multipart 形态：把 spec 文件直接传上去，服务端自己解析（契约只写了 JSON 形态）。 |
| `tool list --toolbox <id> [--name] [--status enabled\|disabled] [--sort-by create_time\|update_time\|tool_name] [--sort-order asc\|desc] [--user-id] [--limit n] [--page n] [--all]` / `tool enable\|disable <tool-ids...> --toolbox <id>` | List / enable-disable. `tool list` backend defaults to 10 (max 100); `--all` returns every tool. `api list` / `function list` 收同样的过滤参数。 |
| `tool execute\|debug <tool-id> --toolbox <id> [--header/--query/--path/--body JSON] [--timeout <s>]` | 调用（`--path` 的值必须都是字符串，否则 CLI 拒绝；`execute` 要求工具已启用且箱子已发布；`debug` 两道门都不受限）。客户端按 `--timeout` 加余量等待；不给时按沙箱上限（3600s）等。信封里 `status_code` ≥ 400 或带 `error` 时 CLI 以非 0 退出（`api` / `function` 的 `execute` / `debug` 同样）。**函数工具的返回套两层**：结果在 `body.result`。 |

典型 OpenAPI 流程：

```bash
openbkn toolbox create --name orders --service-url https://orders.example
openbkn api import ./orders.openapi.yaml --toolbox <box-id>
openbkn api debug <tool-id> --toolbox <box-id> --body '{"id":"o-1"}'   # 发布前试调
openbkn api enable <tool-id> --toolbox <box-id>
openbkn toolbox publish <box-id>
openbkn api execute <tool-id> --toolbox <box-id> --body '{"id":"o-1"}'
```

顺序是 create → import/create → enable → publish → execute。`debug` 在启用、发布之前都能调用；普通 `execute` 要求工具已启用**且**箱子已发布。
`api list` / `function list` 不检查箱子类型：`--toolbox` 指向的箱子 metadata 类型必须与命令组一致（`api` ↔ `openapi`，`function` ↔ `function`）。
通过工具箱代理（`execute` / `debug`）调用函数工具时，平台约 30 秒就切断，无论 `--timeout` 填多大，返回 200 且 `result: null`；长任务改用 `sandbox run`。
调用不是幂等操作，不能自动重试。
