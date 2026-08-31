---
name: openbkn
description: >-
  操作 BKN（Business Knowledge Network）平台的统一 CLI `openbkn` —— 知识网络
  构建/查询（Schema：对象/关系/行动类型、指标、概念组；实例与语义搜索；
  push/pull/validate；从 Vega Catalog 或 CSV 建网）、资源、Vega Catalog 与
  索引构建任务、Context Loader（MCP 检索）、模型工厂（大模型/小模型 CRUD、OpenAI 兼容对话/embedding/
  rerank）、Skill 注册（zip 注册/下载/安装 + 生命周期）、Toolbox/Tool（上传、
  导入导出、调用）、BKN Trace（第三方 Agent 受管
  Conversation / Interaction / Operation、拉取 spans、用符号
  规则 + LLM rubric 判定诊断一条 trace、scan、eval-set 构建、schema 校验）、
  以及运营面（`openbkn admin`：组织/用户/角色 CRUD、审计、模型管理）与认证
  （token + OAuth 密码/浏览器）。
  当用户提到：知识网络 / 知识图谱 / 对象类 / 关系 / 行动 / 指标 metric /
  语义搜索 / 建索引 / create-from-catalog / 大模型 / 小模型 /
  embedding / rerank / Skill / 技能包 /
  toolbox / 工具箱 / tool / 沙箱函数 / function /
  trace / 证据链 / diagnose /
  eval-set / Vega / Catalog / 数据源 / 组织 / 用户 / 角色 / 审计 audit /
  AppKey / api-key / bak_ 凭据 / 签发 key / 撤销 key 等意图时使用。
allowed-tools: Bash(openbkn *), Bash(npx openbkn *)
argument-hint: [自然语言指令]
---

# openbkn CLI

BKN 平台的统一命令行工具 —— 一个二进制，运维面收进 `openbkn admin` 子命令。
纯后端，无 Web UI。

## 第三方 Agent 业务问答硬门禁

- **业务问答必须受管**：每轮先调用 `bkn_start_interaction`；首轮可声明 `agent_name`，后续轮次复用上一轮返回的 `conversation_id` 且不得变更名称。
- **只用权威 ID**：业务工具逐字使用 start 返回的 `conversation_id` 和 `interaction_id`，不得虚构、猜测或沿用示例值。
- **业务调用保持受管**：只通过携带上述 ID 的 Context Loader 工具访问 OpenBKN，Operation、重试和证据闭包由平台管理。
- **提交本轮结果**：回答生成后调用 `bkn_finish_interaction`；它只提交当前 Interaction 的结果，不关闭 Conversation。
- **错误即停止**：返回原始错误并遵循 `required_action`，不得降级到 CLI、Vega、ontology-query 或无受管上下文的调用。

详细合同见 [context.md](references/context.md)。

## 安装

```bash
npm install -g @openbkn/bkn-sdk      # 提供 `openbkn` 命令
```

需 Node.js 22+。也可用 `npx @openbkn/bkn-sdk` 临时运行。

## 使用方式

```bash
openbkn [--base-url <url>] [--token <tok>] [--user <id|name>] \
        [--json | --compact] [-k|--insecure] <group> <sub> [options]
```

- 默认输出为**人类可读表格**；`--json`（或 `--compact`）输出可被脚本解析的精确 JSON。
- `-k/--insecure` 关闭 TLS 校验（自签名平台）。`auth login -k` 会按平台记住，之后该平台的命令无需再带；免校验只作用于该平台的请求，不碰进程全局，无需 `NODE_TLS_REJECT_UNAUTHORIZED`。
- **以实时 `--help` 为准。** `openbkn --help` 看分组命令地图，`openbkn <group> <sub> --help` 看确切参数。**不要猜参数**。

## 认证（凭据按平台/用户分层存于 `~/.bkn/`，可用 `BKN_CONFIG_DIR` 覆盖）

优先级：
1. 全局 `--token` + `--base-url`（或环境 `BKN_BASE_URL` / 活跃平台）→ 一次性 stateless，不读写 `~/.bkn/`。
2. 环境 `BKN_TOKEN` + `BKN_BASE_URL` → 静态 token。
3. `~/.bkn/` 凭据（`openbkn auth login` 写入）→ 推荐；多用户分层。
4. 全局 `--user <id|name>`（或 `BKN_USER`）→ 在该平台已存的多个用户里指定本次用哪个；仅本次生效，不改活跃用户。`BKN_PROFILE` → 切换整个配置档。

```bash
openbkn auth login <url> --token "$TOKEN"      # 附加已有 token（CI/headless）
openbkn auth login <url> -u <user> -p <pwd>    # headless 凭据登录（device-code，无浏览器）
openbkn auth login <url>                        # 打开浏览器批准 device code
openbkn auth login <url> --device               # 只打印 URL+code，在任意机器批准
openbkn auth status | whoami | token | list | use <url> | switch <url> <user> | logout
```

## 命令组总览

| 命令组 | 说明 | 常用命令 |
|--------|------|---------|
| `auth` | 认证 / 会话 / 多用户 | `login`（`--token` / `-u -p` / 浏览器 / `--device`，均走 device-code）、`status`/`whoami`/`token`/`list`/`use`/`switch`/`users`/`export`、`change-password` |
| `config` | 平台 CLI 配置 | `config show` / `config set <key> <value>` |
| `appkey` | 用户自助签发的 AppKey（`bak_` 长期凭据，仅 Context Loader 可用） | `list`、`create --name <s> [--expire-days <n> \| --expires-at <rfc3339> \| --never-expire]`（明文 `key` **只返回一次**）、`regenerate <id>`（轮换：同 id 出新 key，旧 key 立即失效）、`revoke <id>`、`admin list [--owner-id]`/`admin revoke <id>` |
| `bkn` | 知识网络 + Schema + 查询 + 本地包 | `list`/`get`/`search`/`stats`/`export`、`object-type/relation-type/action-type list/get/create/update/delete`、`action-type query/execute`、`metric …`、`concept-group …`、`action-log/action-schedule …`、`subgraph`、`relation-type-paths`、`resources`、`push <dir>`/`pull <kn> [dir]`、`validate <dir>`、`create-from-catalog <catalog> --name …`（`--build`、`--pk-map t:col`） |
| `resource` | Vega-backend 资源 | `list`/`get`/`find --name`/`query`/`delete` |
| `vega` | Catalog + 索引构建 + SQL | `catalog list/get`、`catalog resources`、`connector-types`、`sql --query "<sql>"`（直连 MySQL/PG/OpenSearch，SQL 用 `{{resource-id}}` 占位）、`build`（索引 BuildTask）+ 状态 |
| `context` | MCP 检索 | 业务对话通过 MCP 工具 `bkn_start_interaction` / `bkn_finish_interaction` 管理；CLI 沿用 `tool-call` 透传，不另设生命周期命令 |
| `model` | 模型工厂 | `llm/small list/get/add/edit/delete/test`、`llm chat <name\|id> -m "…" [--stream]`（id 自动解析成 name）、`small embeddings/rerank <name>`（只收 name，填数字 id 会 400；与 chat 不同，暂不解析 id）、`llm set-default/unset-default <id>`、`small set-default/unset-default <id>`、`small get-default [--type embedding\|reranker]` |
| `skill` | Skill 注册/市场/生命周期/沙箱执行 | `list`/`market`/`get`/`names <id...>`/`content`/`read-file`/`files [path] [--tree]`/`history`/`set-status`、`execute <id> --entry '<shell>'`、`register <dir>`/`download`/`install`、`update-metadata`/`update-package`、`republish`/`publish-history`；读类命令带 `--raw`（要正文而非对象存储 URL）与 `--draft`（读草稿版而非已发布版） |
| `toolbox` / `tool` | 工具箱与工具 | toolbox `list/create [--type openapi\|function]/publish/delete/export/import`；tool `create <file> --toolbox <id>`（函数工具唯一入口）/`get`/`update`/`delete`/`upload <spec>`、`enable`/`disable`、`execute`/`debug`（结果在 `body.result`） |
| `function` | 沙箱函数（执行工厂） | `run <file> --event '<json>' [--pass-token]`、`infer-schema`、`deps`、`versions`、`template`。入口函数必须叫 `handler`；成败看 `exit_code` 不是 HTTP 码；留下来就用 `tool create --toolbox` |
| `trace` | BKN Trace | `get`、`search`、`diagnose <conv> [--llm]`（符号规则 + LLM rubric + synthesizer）、`scan <conv,…>`、`eval-set build <queries>`、`schema validate <file>` |
| `admin` | 运营 | `org/user/role …` CRUD + `reset-password`、`license show/import/receipt/activate/remove/fingerprint`（集群授权）、`audit list`、`llm/small-model …`、`auth …`、`config`、`call` |
| `call`（别名 `curl`） | 通用 API 透传 | `call <url> [-X POST] [-d '<json>']` |

**按需深入**：需要某命令的完整参数时运行 `openbkn <group> <sub> --help`，或读对应的速查参考。

**本 CLI 暂未覆盖的平台能力**（别猜命令，直接用 `openbkn call` 打原始接口）：

- Agent 运行时 `bkn-agent`（`/api/bkn-agent/v1/agents`、`/chat`、`/run`、`/tasks`、`/prompts`）
- 执行工厂的 MCP 注册面（`/api/agent-operator-integration/v1/mcp`）
- Skill 索引构建任务（`/api/agent-operator-integration/v1/skills/index/build`）
- `openbkn call /api/<service>/v1/... [-X POST] [-d '<json>']` 会自动注入认证头
- **接口文档在 https://openbkn-ai.github.io/bkn-foundry/** —— 按模块分组的交互式
  OpenAPI（bkn-backend / context-loader / ontology-query / vega-backend /
  execution-factory / agent-observability / bkn-agent）。先在那里查准路径和
  请求体，再 `call`，不要猜路径

另注：知识网络没有"整网构建"这回事，索引数据由 `openbkn vega dataset build <resource-id>` 的
BuildTask 产出；`trace` 的 business-provenance 摘要（requests/interactions）自 foundry 0.1.4 起
只在企业版注册，社区版部署上会 404。

## 详细参考（references/）

| 主题 | 文件 |
|------|------|
| 认证 / 会话 / 多用户 | [auth.md](references/auth.md) |
| AppKey 签发 / 撤销（`bak_`） | [appkey.md](references/appkey.md) |
| 知识网络 + Schema + 查询 + 建网 | [bkn.md](references/bkn.md) |
| 模型工厂 | [model.md](references/model.md) |
| Vega Catalog + 索引构建 | [vega.md](references/vega.md) |
| vega-backend 资源 | [resource.md](references/resource.md) |
| Context Loader（MCP） | [context.md](references/context.md) |
| Skill 注册 / 生命周期 | [skill.md](references/skill.md) |
| Toolbox / Tool | [toolbox.md](references/toolbox.md) |
| 沙箱函数（代码→工具） | [function.md](references/function.md) |
| BKN Trace（diagnose / eval-set） | [trace.md](references/trace.md) |
| 运营（org/user/role/audit） | [admin.md](references/admin.md) |
| 通用 API 透传 | [call.md](references/call.md) |

## 操作指南

| 场景 | 参考 |
|------|------|
| 从 Catalog / CSV 端到端建知识网络 | [build-kn.md](references/build-kn.md) |
| 排障速查（401 / 空列表 / 403 / EACP / trace 索引） | [troubleshooting.md](references/troubleshooting.md) |

## 调用示例

```text
/openbkn 列出所有知识网络
/openbkn 搜索知识网络 xxx 中关于"供应链"的内容
/openbkn 从 Vega catalog vcat-1 建一个名为 customers 的知识网络并构建索引
/openbkn 把本地 ./my-bkn 目录校验后 push 上去
/openbkn 诊断会话 conv-123 的 trace，带 LLM 判定
/openbkn 在 skill market 里找名字含 retrieval 的 skill 并安装到 ./out
/openbkn 把 ./openapi.json 上传到 toolbox 1234567890
/openbkn 列出组织结构；给用户 u-1 重置密码
```

## 注意事项

- **不要预检**：直接执行目标命令，认证由 CLI 处理(token 模式不自动续期；`~/.bkn/` 凭据可用 refresh)。
- **不要猜参数**：使用实时 `--help`；列表为空时先确认当前账号权限和目标资源是否存在。
- **不要猜请求体字段**：带 `--body` / `--body-file` 的命令，其 `--body` 说明里写着该去
  https://openbkn-ai.github.io/bkn-foundry/ 的哪个模块查形状（改定义看 bkn-backend，
  取数/执行看 ontology-query，skill/tool 看 execution-factory，受管交互看
  agent-observability）。`context` 的 `--args` 例外：形状是 MCP 工具自己的 input schema，
  用 `context tools <kn-id>` 取。
- **破坏性操作**（`bkn`/`admin` 的 delete、`admin user reset-password`、Action 执行）作用于线上，执行前向用户确认。
- `trace diagnose --llm`、rubric/synthesizer 用**本地 `claude` CLI** 做判定；`claude` 不在 PATH 时自动降级为纯符号。
- 宽表查询(`object-type query` / `context query-object-instance`)务必限制 `limit`、用分页与 `condition` 过滤，避免 JSON 截断。
