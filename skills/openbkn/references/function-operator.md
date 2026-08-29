# function / operator — 沙箱函数与算子（执行工厂）

一段代码在平台上有三个身份，越往下越正式：

| 身份 | 命令 | 是什么 |
|------|------|--------|
| 函数 | `openbkn function run` | 送进沙箱跑一次，什么都不留 |
| 算子 | `openbkn operator register` | 留下来：有名字、有版本、可发布（Studio 里叫「函数集」） |
| 工具 | `openbkn operator convert-to-tool` | 放进工具箱，Agent 只调工具，不直接调算子 |

## function

| Command | Notes |
|---------|-------|
| `function template [--type python]` | 入口骨架。**入口函数必须叫 `handler`**，签名 `handler(event) -> Any`。 |
| `function deps` | 沙箱里已装好的库，列表里有的直接 `import`，不用再 `--dep`。 |
| `function versions <package> [--python 3.10] [--index-url <url>]` | 实时问包索引；内网不通就换 `--index-url`。 |
| `function run <file\|-> [--event '<json>'] [--timeout <s>] [--dep name@version] [--index-url <url>]` | 跑代码。`--event` 就是 `handler` 的那个入参；`-` 从 stdin 读代码。 |
| `function infer-schema <file>` | 从 `@tool` 装饰的代码反推参数定义；**会真的执行代码**。推不出来不是错误，返回 `supported: false`。 |

**读返回值**：代码自己抛异常时接口仍是 HTTP 200，看 `exit_code`（0 才成功）与
`stderr`。`function run` 会把非零 `exit_code` 映射成进程退出码，所以 shell 里
`&&` 串起来是对的。

`--dep` 会在执行前装包，首次调用明显变慢；已预装的库别声明。

## operator

| Command | Notes |
|---------|-------|
| `operator list [--keyword] [--status] [--category] [--type basic\|composite] [--all]` | 工作区全部算子（含未发布）。 |
| `operator get <operator-id>` / `names <operator-ids...>` / `categories` | 详情 / 批量取名（不存在的 id 静默略过）/ 可用分类。 |
| `operator history <operator-id> [version]` | 已发布过的版本；带 `version` 看那一版的完整定义。 |
| `operator market [--status published\|offline]` / `market-get <operator-id>` | 市场视角。市场只有这两个状态，传 `editing` 会 400。 |
| `operator register <file> --name <n> --description <d> [--inputs '<json>'] [--outputs '<json>'] [--category] [--dep] [--publish]` | 注册。`--type openapi` 时 `<file>` 是 OpenAPI 原文，不需要 `--name`。返回 `operator_id` + `version`。 |
| `operator update <operator-id> <file> …` | 整包替换，产生新版本，并把已发布的算子推回 `editing`。 |
| `operator debug <operator-id> <version> [--body '<json>']` | 跑指定版本。**版本是位置参数**（`--version` 是 CLI 自己的标志）。函数类算子只用 `--body`。 |
| `operator publish <ids...>` / `offline <ids...>` / `delete <ids...>` | 生命周期。 |
| `operator convert-to-tool <operator-id> --toolbox <box-id>` | 在工具箱里生成对应工具，保留血缘。 |

**状态只能一步一步走**：`unpublish -> published -> offline`；`update` 会把算子
推回 `editing`，而 `editing -> offline` 会被拒（`invalid status transition`）——
先 `publish` 再 `offline`。

`--inputs` / `--outputs` 是大模型判断怎么调用的依据，写法
`[{"name":"a","type":"number","required":true,"description":"…"}]`；不写也能注册，
只是算子没有描述。

## 两条路都能到工具

同一段代码有两种落地方式，按要不要复用来选：

| | 命令 | 什么时候用 |
|---|---|---|
| 算子路线 | `operator register` → `convert-to-tool --toolbox` | 要版本、要历史、要上市场，或同一能力放进多个箱子 |
| 直建路线 | `tool create <file> --toolbox <id>` | 只在这一个箱子里要一个函数工具，四步到底 |

直建路线（见 [toolbox.md](toolbox.md)）：

```bash
openbkn toolbox create --name my_funcs --type function            # -> box_id
openbkn tool create ./add.py --toolbox <box-id> --name add \
    --description "把两个数相加" \
    --inputs '[{"name":"a","type":"number","required":true}]'      # -> success_ids
openbkn tool enable <tool-id> --toolbox <box-id>                  # 默认 disabled，这一步是硬门
openbkn tool execute <tool-id> --toolbox <box-id> --body '{"a":1,"b":2}'
```

三个实测出来的细节：

- **参数 type 只收 `string` / `number` / `boolean` / `array` / `object`**，写 `integer` 直接 400（`FunctionInvalidParameterType`）。
- **发布箱子只影响市场可见性**，不卡执行；卡执行的是 tool 的 `enabled`。
- **`data` 字段两个端点不一样**：`tool create --type openapi` 要的是解析后的文档（CLI 已代为解析，JSON/YAML 都行），而 `operator register --type openapi` 要的是原文字符串。

## 端到端

```bash
openbkn function run ./add.py --event '{"a":1,"b":2}'          # 先把代码跑通
openbkn operator register ./add.py --name add \
    --description "把两个数相加" \
    --inputs '[{"name":"a","type":"number","required":true},
               {"name":"b","type":"number","required":true}]' \
    --outputs '[{"name":"sum","type":"number"}]' --publish       # -> operator_id + version
openbkn operator debug <operator-id> <version> --body '{"a":20,"b":22}'
openbkn toolbox create --name my_box --type function            # 函数类工具箱不填 --service-url
openbkn operator convert-to-tool <operator-id> --toolbox <box-id>
openbkn tool enable <tool-id> --toolbox <box-id>                # 工具默认 disabled
openbkn toolbox publish <box-id>
openbkn tool execute <tool-id> --toolbox <box-id> --body '{"a":5,"b":6}'
```

工具箱与工具本身见 [toolbox.md](toolbox.md)。
