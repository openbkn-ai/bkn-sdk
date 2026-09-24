# @openbkn/bkn-sdk

BKN（Business Knowledge Network）平台的统一 TypeScript SDK + CLI。一套工具、两个入口：
可 import 的 SDK 与 `openbkn` 命令行——共享同一套领域逻辑。面向 BKN 平台的
统一命令行工具，运维面收进 `openbkn admin` 子命令。纯后端，无 Web UI。

> 状态：预发布。各域的读命令已实现并在真实平台上验证；部分写操作与 BKN Trace
> 引擎仍在进行中（见 `docs/exec-plans/tech-debt-tracker.md`）。

## 安装

```bash
npm install -g @openbkn/bkn-sdk   # CLI：openbkn
# 或作为库
npm install @openbkn/bkn-sdk
```

需要 Node ≥ 22.19.0。

## CLI

```bash
# 登录（附着 token；OAuth 流程待实现）
openbkn auth login https://你的平台 --token "$TOKEN"

# 知识网络
openbkn bkn list
openbkn bkn get <kn-id> --stats
openbkn bkn search <kn-id> "客户流失"
openbkn bkn object-type list <kn-id>

# 数据平台
openbkn resource list --type table
openbkn vega catalog list
openbkn model llm list

# 运维（嵌套）
openbkn admin org list
openbkn admin role list

# 任意端点的原始透传
openbkn call /api/bkn-backend/v1/knowledge-networks

# 返回 MCP 工具结果及其已校验的 BKN Trace Receipt
openbkn --json context tool-call <kn-id> <tool-name> --args '{"k":"v"}' --receipt

# 全局参数：--base-url --token --user --json/--compact -k/--insecure
#           --conversation-id/--interaction-id（BKN Trace 关联，等价 env：BKN_CONVERSATION_ID/BKN_INTERACTION_ID）
#           --new-conversation（这条命令不沿用记住的 conversation）
openbkn --help        # 分组命令树
```

`managed-v2` 部署上，命令会接着上一条开的 conversation，跨命令的一件事因此落在同一个线程里。
`openbkn context conversation` 显示当前生效的是哪个、来自哪一层；`--forget` 丢掉它。
显式 `--token` / `BKN_TOKEN` 不参与（那里的身份是 token 本身，不是存下来的用户）——
这类脚本用 `BKN_CONVERSATION_ID` 把多条命令串起来。
既有脚本可以单独提供 `--interaction-id` / `BKN_INTERACTION_ID`。SDK 会走自动 lifecycle handshake；
一旦建立权威上下文，孤立 ID 不会再作为业务 header 透传，也不会在本地伪造对应的 Conversation ID；以返回的
Receipt 确认权威业务上下文。

`context tool-call --receipt` 必须带 `--json` 或 `--compact`，输出 `{ value, bkn_receipt }`（
`--compact` 即单行形式）。这是显式选择；默认命令输出和 SDK 的 `context.toolCall()` 仍只返回
业务值。Receipt 仅证明其已通过本次调用的字段校验，不是 bearer credential；需要授权证据时，
应在当前身份下运行 `openbkn trace receipts get <receipt-id>` 回读确认。
不要用 `value` 是否为 `null` 判断结果是否可用；应检查 `bkn_receipt.receipt_status`。`pending` 表示
业务值不可消费，应使用 `receipt_id` 回读，而不是重试业务工具。0.1.5 平台上 `completed` 回执只带
`receipt_status`、`evidence_durability`、`observed_evidence_refs`、`business_refs`（有 `partial_reasons` 时一并带上），
没有 `receipt_id`；需要回读完整记录时，用 `openbkn trace interactions operations <interaction-id>` 找到该次调用的
`receipt_id`，再执行 `openbkn trace receipts get`。`pending` 与终态重放回执仍带身份字段。

Token 按平台/用户存于 `~/.bkn/`（可用 `BKN_CONFIG_DIR` 覆盖）。

## SDK

```ts
import { createClient } from "@openbkn/bkn-sdk";

const bkn = createClient({ baseUrl: "https://你的平台", token: process.env.BKN_TOKEN });

const networks = await bkn.kn.list({ limit: 10 });
const task = await bkn.vega.build({ resource_id: "r-1", mode: "batch" }, { wait: true });
const raw = await bkn.call("/api/...", { method: "GET" });
```

import 本包无副作用；`createClient` 显式解析配置。

首次向某个平台发请求前，SDK 会校验平台版本与自身是否一致，不一致时抛出
`VersionCompatibilityError` 且不发出任何请求。设 `BKN_SKIP_VERSION_CHECK=1` 可照常发送 ——
用于平台报占位版本号或开发构建、任何发布版都匹配不上的情况。库调用方用这个环境变量，
CLI 另有 `--skip-version-check`。

Vega 和本体查询等动态数据响应中，超出 JavaScript 安全整数范围的值可能是原生 `bigint`。
序列化这类结果时，请使用导出的 `stringifyBigIntJSON()`，不要使用原生
`JSON.stringify()`。

## 开发

```bash
npm install
npm run lint     # biome + tsc --noEmit
npm test         # vitest（单测）
npm run build    # tsup → dist/（库 + openbkn bin）
```

## 帮助系统

每个命令、子命令、孙命令都带分组 `--help`，列出各自的参数与位置参数，
整棵命令树可端到端发现。`openbkn help all` 输出全深度的逐动作签名清单。

## Agent 技能

`skills/openbkn/` 是一个 Agent 技能（面向 Claude Code / [skills.sh](https://skills.sh)
生态），让 AI 用自然语言驱动 `openbkn` CLI。它包含一份 `SKILL.md`（触发意图、
`allowed-tools: Bash(openbkn *)`、命令组地图、示例与注意事项），`references/` 下
按领域划分的速查表（auth、appkey、bkn、model、vega、resource、context、mcp、
skill、toolbox、function、osdk、trace、admin、call），以及两篇操作指南
（建知识网络、排障）。

第二个技能 `skills/create-bkn/` 引导 AI **编写** BKN 定义目录（`network.bkn` +
按类型分目录的 `object_types/` / `relation_types/` / `action_types/` /
`concept_groups/` 文件，遵循 v2.0.1 规范），`references/` 下附格式规范、模板和
完整示例。它与 `openbkn` 技能配合：产出的目录再由 `openbkn bkn validate` / `push`
校验和导入。

第三个技能 `skills/create-skill/` 引导 AI 为执行工厂**编写 Skill 包**——一份
`SKILL.md`，声明它用到某个知识网络的哪些指标、函数、行动和 MCP 工具，以及 Agent
该如何调用——并用 `bkn-osdk` 编写沙箱函数、注册成工具。`assets/` 与 `references/`
下有模板和一个端到端验证过的示例。

这些技能都不在 npm 包里，需要单独安装：

```bash
# 全局安装技能，然后用自然语言提问：
npx skills add openbkn-ai/bkn-sdk@openbkn -g -y        # 操作平台
npx skills add openbkn-ai/bkn-sdk@create-bkn -g -y     # 编写 .bkn 文件
npx skills add openbkn-ai/bkn-sdk@create-skill -g -y   # 编写 Skill 包 / 函数工具

#   "列出所有知识网络"
#   "从 Vega catalog vcat-1 建一个名为 customers 的知识网络并构建索引"
#   "帮我建一个描述订单域的 BKN 知识网络文件"
```

`openbkn` 技能假定已安装 `openbkn` CLI（`npm i -g @openbkn/bkn-sdk`）并已登录
（`openbkn auth login`）。确切参数始终以实时 `openbkn <group> <sub> --help` 为准。

## 许可证

BKN SDK 是 OpenBKN 项目的一部分，采用 **Apache License, Version 2.0**。
见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。
