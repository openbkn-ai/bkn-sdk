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
| `sandbox generate <type> [--timeout <s>]` / `sandbox prompt <type>` | 让平台模型生成函数代码或参数元数据（默认等 300 秒），或读取对应提示词模板。 |

**读返回值**：代码自己抛异常时接口仍是 HTTP 200，看 `exit_code`（0 才成功）与
`stderr`。`sandbox run` 会把非零 `exit_code` 映射成进程退出码，所以 shell 里
`&&` 串起来是对的。

**沙箱里的上下文**：`--conversation-id` / `--interaction-id` 会同时写进请求头
**和**沙箱环境变量 `BKN_CONVERSATION_ID` / `BKN_INTERACTION_ID` —— 后者是
`sandbox_sdk.bkn` 回调 BKN 时挂到哪次交互的依据，只有请求体里的
`bkn_conversation_id` 等字段能填，请求头到服务就停了（实测头单独发时三个变量都是空）。
凭据不自动发：要让沙箱里的代码以你的身份调 BKN，显式加 `--pass-token`，它才把
令牌放进 `BKN_TOKEN`（`--dry-run` 预览会把这个字段打码）。

**超时有两道墙**：`--timeout` 抬的是沙箱与客户端的预算，但网关（nginx）自己有
约 300 秒的读超时，超过就是 504，跟 `--timeout` 填多大无关。长任务别指望同步等。
`sandbox generate` 是一次模型调用，客户端默认等到网关的 300 秒上限（不是通用的 30 秒），`--timeout <s>` 可调。

## function

| Command | Notes |
|---------|-------|
| `function create <file> --toolbox <id> --name <n> [--description] [--inputs/--outputs '<json>']` | 注册 Function Tool。 |
| `function list --toolbox <id> [--name] [--status enabled\|disabled] [--sort-by …] [--sort-order asc\|desc] [--user-id] [--limit n] [--page n] [--all]` / `get <tool-id> --toolbox <id>` | 列表和详情；过滤参数同 `tool list`。 |
| `function update <tool-id> <file> --toolbox <id> --name <n> --description <d>` | 整体覆盖，工具 id 保持不变。 |
| `function enable\|disable <tool-id> --toolbox <id>` | 执行前的启用开关。 |
| `function execute\|debug <tool-id> --toolbox <id> --body '<json>' [--timeout <s>]` | `execute` 要求工具已启用**且**箱子已 `toolbox publish`（否则 400 `ToolNotAvailable`）；`debug` 在启用、发布前都能调用。 |

## 端到端

```bash
openbkn sandbox run ./add.py --event '{"a":1,"b":2}'          # 先把代码跑通
openbkn toolbox create --name my_funcs --type function          # 函数类工具箱不填 --service-url
openbkn function create ./add.py --toolbox <box-id> --name add \
  --description "把两个数相加" \
  --inputs '[{"name":"a","type":"number","required":true},
             {"name":"b","type":"number","required":true}]' \
  --outputs '[{"name":"sum","type":"number"}]'                  # -> success_ids
openbkn function debug <tool-id> --toolbox <box-id> --body '{"a":1,"b":2}'   # 发布前试调
openbkn function enable <tool-id> --toolbox <box-id>            # 默认 disabled
openbkn toolbox publish <box-id>                                # 箱子未发布时 execute 返回 400 ToolNotAvailable
openbkn function execute <tool-id> --toolbox <box-id> --body '{"a":1,"b":2}'
```

实测出来的细节：

- **参数 type 只收 `string` / `number` / `boolean` / `array` / `object`**，写 `integer` 直接 400（`FunctionInvalidParameterType`）。
- **执行有两道门**：工具要 `enabled`，箱子要 `published`。顺序是 create 箱子 → create 工具 → enable → publish → execute；箱子未发布或已 `offline` 时 `execute` 返回 400 `ToolNotAvailable`；`debug` 发布前就能用（见 [toolbox.md](toolbox.md)）。
- **工具箱代理约 30 秒切断**：`function execute` / `debug` 经工具箱代理调用，平台约 30 秒就断开，无论 `--timeout` 多大，返回 200 且 `result: null`。长任务用 `sandbox run`。
- **失败以非零退出**：信封里 `status_code` ≥ 400 或带 `error` 时，`function execute` / `debug` 以非 0 退出。
- **函数工具的返回套两层**：结果在 `body.result`。
- `function list` 不检查箱子类型，`--toolbox` 必须是 `--type function` 的箱子。

工具箱和 OpenAPI 工具见 [toolbox.md](toolbox.md)。
