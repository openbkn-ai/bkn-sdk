---
name: openbkn
description: >-
  操作 BKN（Business Knowledge Network）平台的统一 CLI `openbkn` —— 知识网络
  构建/查询（Schema：对象/关系/行动类型、指标、概念组；实例与语义搜索；
  push/pull/validate；从 Vega Catalog 或 CSV 建网）、资源、Vega Catalog 与
  索引构建任务、Context Loader（MCP 检索）、Decision Agent（CRUD、流式对话、
  会话、挂载技能）、模型工厂（大模型/小模型 CRUD、OpenAI 兼容对话/embedding/
  rerank）、Skill 注册（zip 注册/下载/安装 + 生命周期）、Toolbox/Tool（上传、
  导入导出、调用）、Dataflow 文档流程（+模板）、Trace-AI（拉取 spans、用符号
  规则 + LLM rubric 判定诊断一条 trace、scan、eval-set 构建/测试、schema 校验）、
  以及运营面（`openbkn admin`：组织/用户/角色 CRUD、审计、模型管理）与认证
  （token + OAuth 密码/浏览器）。
  当用户提到：知识网络 / 知识图谱 / 对象类 / 关系 / 行动 / 指标 metric /
  语义搜索 / 建索引 / create-from-catalog / create-from-csv / Agent / 智能体 /
  跟 Agent 对话 / 大模型 / 小模型 / embedding / rerank / Skill / 技能包 /
  toolbox / 工具箱 / tool / dataflow / 数据流 / trace / 证据链 / diagnose /
  eval-set / Vega / Catalog / 数据源 / 组织 / 用户 / 角色 / 审计 audit 等意图时使用。
allowed-tools: Bash(openbkn *), Bash(npx openbkn *)
argument-hint: [自然语言指令]
---

# openbkn CLI

BKN 平台命令行工具 —— 把旧的 `kweaver-sdk` + `kweaver-admin` 精简重写并合并为
一个二进制。`kweaver <x>` → `openbkn <x>`；`kweaver-admin <x>` → `openbkn admin <x>`。
纯后端，无 Web UI。

## 安装

```bash
npm install -g @openbkn/bkn-sdk      # 提供 `openbkn` 命令
```

需 Node.js 22+。也可用 `npx @openbkn/bkn-sdk` 临时运行。

## 使用方式

```bash
openbkn [--base-url <url>] [--token <tok>] [--user <id|name>] \
        [--json | --compact] [-bd|--biz-domain <d>] [-k|--insecure] <group> <sub> [options]
```

- 默认输出为**人类可读表格**；`--json`（或 `--compact`）输出可被脚本解析的精确 JSON。
- `-k/--insecure` 关闭 TLS 校验（自签名平台）；脚本里刷新 token 可能也需 `NODE_TLS_REJECT_UNAUTHORIZED=0`。
- `-bd <domain>` 覆盖 `x-business-domain`（默认 `bd_public`）。
- **以实时 `--help` 为准。** `openbkn --help` 看分组命令地图，`openbkn <group> <sub> --help` 看确切参数。**不要猜参数**。

## 认证（凭据按平台/用户分层存于 `~/.bkn/`，可用 `BKN_CONFIG_DIR` 覆盖）

优先级：
1. 全局 `--token` + `--base-url`（或环境 `BKN_BASE_URL` / 活跃平台）→ 一次性 stateless，不读写 `~/.bkn/`。
2. 环境 `BKN_TOKEN` + `BKN_BASE_URL` → 静态 token。
3. `~/.bkn/` 凭据（`openbkn auth login` 写入）→ 推荐；多用户分层。
4. 全局 `--user` / `BKN_PROFILE` → 指定用户/配置档。

```bash
openbkn auth login <url> --token "$TOKEN"      # 附加已有 token（CI/headless）
openbkn auth login <url> -u <user> -p <pwd>    # headless OAuth 密码登录（RSA 加密）
openbkn auth login <url>                        # 浏览器 PKCE（本地回调）
openbkn auth status | whoami | token | list | use <url> | switch <url> <user-id> | logout
```

## 命令组总览

| 命令组 | 说明 | 常用命令 |
|--------|------|---------|
| `auth` | 认证 / 会话 / 多用户 | `login`（token / `-u -p` OAuth / 浏览器）、`status`/`whoami`/`token`/`list`/`use`/`switch`/`users`/`export`、`change-password` |
| `config` | 平台 CLI 配置 | `config show` / `config set <key> <value>` |
| `bkn` | 知识网络 + Schema + 查询 + 本地包 | `list`/`get`/`search`/`stats`/`export`、`object-type/relation-type/action-type list/get/create/update/delete`、`action-type query/execute/inputs`、`metric …`、`concept-group …`、`action-log/action-schedule/job …`、`subgraph`、`relation-type-paths`、`resources`、`push <dir>`/`pull <kn> [dir]`、`validate <dir>`、`create-from-catalog <catalog> --name …`、`create-from-csv <catalog> --files <glob> --name …`（`--build`、`--pk-map t:col`） |
| `resource` | Vega-backend 资源 | `list`/`get`/`find --name`/`query`/`delete` |
| `vega` | Catalog + 索引构建 | `catalog list/get`、`catalog resources`、`connector-types`、`build`（索引 BuildTask）+ 状态 |
| `context` | MCP 检索 | `info`（全局 tool 目录，无需 KN）、`search-schema`、`query-object-instance`、`find-skills`、`tools <kn>`、`tool-call <name> [--arg k=v]`、`call-method <method>`、`resources/templates/prompts`、`query-instance-subgraph`/`get-logic-properties`/`get-action-info`；新工具用 `info`/`tools` 发现 + `tool-call` 调用，无需改 CLI |
| `agent` | Decision Agent | `list`/`personal-list`/`template-list`/`get`/`create`/`update`/`delete`/`publish`、`chat <id> -m "…" [--stream]`、`sessions`、`history`、`trace`、`skill list/add/remove` |
| `model` | 模型工厂 | `llm/small list/get/add/edit/delete/test`、`llm chat <id> -m "…" [--stream]`、`small embeddings/rerank` |
| `skill` | Skill 注册/市场/生命周期 | `list`/`market`/`get`/`content`/`read-file`/`history`/`set-status`、`register <dir>`/`download`/`install`、`update-metadata`/`update-package`、`republish`/`publish-history` |
| `toolbox` / `tool` | 工具箱与工具 | toolbox `list/create/publish/delete/export/import`；tool `upload <file> --toolbox <id>`、`execute`/`debug` |
| `dataflow` | 文档流程 | `list`/`runs`/`logs`/`run`、`create`（JSON 文档）、`templates`/`create-dataset`/`create-bkn`（`--template <name> --set k=v`） |
| `trace` | Trace-AI | `get`、`search`、`diagnose <conv> [--llm]`（符号规则 + LLM rubric + synthesizer）、`scan <conv,…>`、`eval-set build <queries>`/`test <cases> --agent <id> [--llm]`、`schema validate <file>` |
| `admin` | 运营（kweaver-admin） | `org/user/role …` CRUD + `reset-password`、`audit list`、`llm/small-model …`、`auth …`、`config`、`call` |
| `call`（别名 `curl`） | 通用 API 透传 | `call <url> [-X POST] [-d '<json>']` |
| `explore` | 本地只读服务（bkn + vega JSON） | `explore [--port <n>]` |

**按需深入**：需要某命令的完整参数时运行 `openbkn <group> <sub> --help`，或读对应的速查参考。

## 详细参考（references/）

| 主题 | 文件 |
|------|------|
| 认证 / 会话 / 多用户 | [auth.md](references/auth.md) |
| 知识网络 + Schema + 查询 + 建网 | [bkn.md](references/bkn.md) |
| Agent CRUD / 对话 / 挂载技能 | [agent.md](references/agent.md) |
| 模型工厂 | [model.md](references/model.md) |
| Vega Catalog + 索引构建 | [vega.md](references/vega.md) |
| vega-backend 资源 | [resource.md](references/resource.md) |
| Dataflow + 模板 | [dataflow.md](references/dataflow.md) |
| Context Loader（MCP） | [context.md](references/context.md) |
| Skill 注册 / 生命周期 | [skill.md](references/skill.md) |
| Toolbox / Tool | [toolbox.md](references/toolbox.md) |
| Trace-AI（diagnose / eval-set） | [trace.md](references/trace.md) |
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
/openbkn 有哪些 Agent；跟 Agent xxx 流式对话问"今天库存情况"
/openbkn 诊断会话 conv-123 的 trace，带 LLM 判定
/openbkn 在 skill market 里找名字含 kweaver 的 skill 并安装到 ./out
/openbkn 把 ./openapi.json 上传到 toolbox 1234567890
/openbkn 列出组织结构；给用户 u-1 重置密码
```

## 注意事项

- **不要预检**：直接执行目标命令，认证由 CLI 处理(token 模式不自动续期；`~/.bkn/` 凭据可用 refresh)。
- **不要猜 business domain / 参数**：用 `--help`；列表为空时确认 `-bd`。
- **破坏性操作**（`bkn`/`admin` 的 delete、`admin user reset-password`、Action 执行）作用于线上，执行前向用户确认。
- `trace diagnose --llm`、`eval-set test --llm`、rubric/synthesizer 用**本地 `claude` CLI** 做判定；`claude` 不在 PATH 时自动降级为纯符号 / 跳过 `semantic_match`。
- 宽表查询(`object-type query` / `context query-object-instance`)务必限制 `limit`、用分页与 `condition` 过滤，避免 JSON 截断。
