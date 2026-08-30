# function — 沙箱函数（执行工厂）

一段代码在平台上有两个身份：

| 身份 | 命令 | 是什么 |
|------|------|--------|
| 函数 | `openbkn function run` | 送进沙箱跑一次，什么都不留 |
| 工具 | `openbkn tool create --toolbox <id>` | 留在工具箱里，Agent 调的是它 |

## function

| Command | Notes |
|---------|-------|
| `function template [--type python]` | 入口骨架。**入口函数必须叫 `handler`**，签名 `handler(event) -> Any`。 |
| `function deps` | 沙箱里已装好的库，列表里有的直接 `import`，不用再 `--dep`。 |
| `function versions <package> [--python 3.10] [--index-url <url>]` | 实时问包索引；内网不通就换 `--index-url`。 |
| `function run <file\|-> [--event '<json>'] [--timeout <s>] [--dep name@version] [--index-url <url>] [--pass-token]` | 跑代码。`--event` 就是 `handler` 的那个入参；`-` 从 stdin 读代码。 |
| `function infer-schema <file>` | 从 `@tool` 装饰的代码反推参数定义；**会真的执行代码**。推不出来不是错误，返回 `supported: false`。 |

**读返回值**：代码自己抛异常时接口仍是 HTTP 200，看 `exit_code`（0 才成功）与
`stderr`。`function run` 会把非零 `exit_code` 映射成进程退出码，所以 shell 里
`&&` 串起来是对的。

**沙箱里的上下文**：`--conversation-id` / `--interaction-id` 会同时写进请求头
**和**沙箱环境变量 `BKN_CONVERSATION_ID` / `BKN_INTERACTION_ID` —— 后者是
`sandbox_sdk.bkn` 回调 BKN 时挂到哪次交互的依据，只有请求体里的
`bkn_conversation_id` 等字段能填，请求头到服务就停了（实测头单独发时三个变量都是空）。
凭据不自动发：要让沙箱里的代码以你的身份调 BKN，显式加 `--pass-token`，它才把
令牌放进 `BKN_TOKEN`（`--dry-run` 预览会把这个字段打码）。

**超时有两道墙**：`--timeout` 抬的是沙箱与客户端的预算，但网关（nginx）自己有
约 300 秒的读超时，超过就是 504，跟 `--timeout` 填多大无关。长任务别指望同步等。

## 端到端

```bash
openbkn function run ./add.py --event '{"a":1,"b":2}'          # 先把代码跑通
openbkn toolbox create --name my_funcs --type function          # 函数类工具箱不填 --service-url
openbkn tool create ./add.py --toolbox <box-id> --name add \
    --description "把两个数相加" \
    --inputs '[{"name":"a","type":"number","required":true},
               {"name":"b","type":"number","required":true}]' \
    --outputs '[{"name":"sum","type":"number"}]'                # -> success_ids
openbkn tool enable <tool-id> --toolbox <box-id>                # 默认 disabled，这一步是硬门
openbkn tool execute <tool-id> --toolbox <box-id> --body '{"a":1,"b":2}'
```

三个实测出来的细节：

- **参数 type 只收 `string` / `number` / `boolean` / `array` / `object`**，写 `integer` 直接 400（`FunctionInvalidParameterType`）。
- **发布箱子只影响市场可见性**，不卡执行；卡执行的是 tool 的 `enabled`。
- **函数工具的返回套两层**：结果在 `body.result`。

工具箱与工具本身见 [toolbox.md](toolbox.md)。
