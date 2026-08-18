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

需要 Node ≥ 24.19.0。

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
openbkn dataflow list
openbkn model llm list

# 智能体
openbkn agent list
openbkn agent sessions <agent-key>

# 运维（嵌套）
openbkn admin org list
openbkn admin role list

# 任意端点的原始透传
openbkn call /api/ontology-manager/v1/knowledge-networks

# 全局参数：--base-url --token --user --json/--compact -bd/--biz-domain -k/--insecure
#           --conversation-id/--interaction-id（BKN Trace 关联，等价 env：BKN_CONVERSATION_ID/BKN_INTERACTION_ID）
#           --new-conversation（这条命令不沿用记住的 conversation）
openbkn --help        # 分组命令树
```

`managed-v2` 部署上，命令会接着上一条开的 conversation，跨命令的一件事因此落在同一个线程里。
`openbkn context conversation` 显示当前生效的是哪个、来自哪一层；`--forget` 丢掉它。

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

Vega 动态数据响应中，超出 JavaScript 安全整数范围的值可能是原生 `bigint`。
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

## 许可证

BKN SDK 是 OpenBKN 项目的一部分，采用 **Apache License, Version 2.0**。
见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。
