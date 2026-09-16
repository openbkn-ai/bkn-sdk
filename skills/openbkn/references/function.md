# sandbox / function — 临时代码与持久函数工具

一段 Python 代码在平台上有两个身份，命令名称区分它是否会被保存：

| 身份 | 命令 | 是什么 |
|------|------|--------|
| 沙箱代码 | `openbkn sandbox run` | 送进沙箱跑一次，什么都不留 |
| 函数工具 | `openbkn function create --toolbox <id>` | 留在工具箱里，Agent 可以调用 |

## sandbox

| Command | Notes |
|---------|-------|
| `sandbox template [--type python]` | 入口骨架。**入口函数必须叫 `handler`**，签名 `handler(event) -> Any`。 |
| `sandbox deps` / `sandbox versions <package>` | 查看沙箱已安装库，或实时查询包索引。 |
| `sandbox run <file\|-> [--event '<json>'] [--timeout <s>] [--dep name@version] [--index-url <url>] [--pass-token]` | 跑一次代码。`--event` 是 `handler` 入参；`-` 从 stdin 读代码。 |
| `sandbox infer-schema <file>` | 从 `@tool` 装饰的代码反推参数定义；会真的执行代码。 |
| `sandbox generate <type>` / `sandbox prompt <type>` | 让平台模型生成函数代码或参数元数据，或读取对应提示词模板。 |

代码自己抛异常时接口仍是 HTTP 200，看 `exit_code`（0 才成功）与 `stderr`。
`sandbox run` 会把非零 `exit_code` 映射为进程退出码。`--pass-token` 才会把凭据放进沙箱的 `BKN_TOKEN`；`--dry-run` 会打码。

## function

| Command | Notes |
|---------|-------|
| `function create <file> --toolbox <id> --name <n> [--description] [--inputs/--outputs '<json>']` | 注册 Function Tool。 |
| `function list --toolbox <id>` / `get <tool-id> --toolbox <id>` | 列表和详情。 |
| `function update <tool-id> <file> --toolbox <id> --name <n> --description <d>` | 整体覆盖，工具 id 保持不变。 |
| `function enable\|disable <tool-id> --toolbox <id>` | 执行前的启用开关。 |
| `function execute\|debug <tool-id> --toolbox <id> --body '<json>'` | 执行；`debug` 可以调用未启用的工具。 |

## 端到端

```bash
openbkn sandbox run ./add.py --event '{"a":1,"b":2}'
openbkn toolbox create --name my_funcs --type function
openbkn function create ./add.py --toolbox <box-id> --name add \
  --description "把两个数相加"
openbkn function enable <tool-id> --toolbox <box-id>
openbkn function execute <tool-id> --toolbox <box-id> --body '{"a":1,"b":2}'
```

函数工具的返回套两层，业务结果在 `body.result`。工具箱和 OpenAPI 工具见 [toolbox.md](toolbox.md)。
