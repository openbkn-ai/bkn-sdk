# toolbox / api / tool — 工具箱与持久能力

| Command | Notes |
|---------|-------|
| `toolbox list [--keyword] [--limit]` | List toolboxes. |
| `toolbox create --name <n> [--type openapi\|function] [--service-url <url>] [--description]` | Create. `openapi` 箱子代理到 `--service-url`（必填）；`function` 箱子装平台函数。 |
| `toolbox publish <id>` / `unpublish <id>` / `delete <id>` | 生命周期。发布影响市场可见性，不阻塞已启用工具的执行。 |
| `toolbox export <id> -o box.adp` / `toolbox import <file>` | 移动整箱配置。 |
| `api import <openapi-file> --toolbox <id>` | 从 JSON 或 YAML 规范导入 OpenAPI Tools。一个规范可产生多个操作；`failure_count` 非零时命令以非零退出。 |
| `api list\|get\|update\|delete\|enable\|disable\|execute\|debug … --toolbox <id>` | 管理和执行已注册的 OpenAPI Tools。 |
| `function create\|list\|get\|update\|delete\|enable\|disable\|execute\|debug … --toolbox <id>` | 管理和执行已注册的 Function Tools。函数代码试跑用 `sandbox`。 |
| `tool …` | 高级、类型无关的 Toolbox/Tool 入口，兼容已有自动化；`tool create --type openapi` 和 `tool upload` 保留。 |

典型 OpenAPI 流程：

```bash
openbkn toolbox create --name orders --service-url https://orders.example
openbkn api import ./orders.openapi.yaml --toolbox <box-id>
openbkn api enable <tool-id> --toolbox <box-id>
openbkn api execute <tool-id> --toolbox <box-id> --body '{"id":"o-1"}'
openbkn toolbox publish <box-id>
```

`debug` 能调用未启用工具；普通 `execute` 需要工具已启用。调用不是幂等操作，不能自动重试。
