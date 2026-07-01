# @openbkn/bkn-sdk

BKN（Business Knowledge Network）平台的统一 TypeScript SDK + CLI。一套工具、两个入口：
可 import 的 SDK 与 `openbkn` 命令行——共享同一套领域逻辑。面向 BKN 平台的
统一命令行工具，运维面收进 `openbkn admin` 子命令。纯后端，无 Web UI。

> 状态：预发布。各域的读命令已实现并在真实平台上验证；部分写操作与 Trace-AI
> 引擎仍在进行中（见 `docs/exec-plans/tech-debt-tracker.md`）。

## 安装

```bash
npm install -g @openbkn/bkn-sdk   # CLI：openbkn
# 或作为库
npm install @openbkn/bkn-sdk
```

需要 Node ≥ 22。

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
openbkn --help        # 分组命令树
```

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

## 开发

```bash
npm install
npm run lint     # biome + tsc --noEmit
npm test         # vitest（单测；等价套件由 BKN_EQUIV_LIVE 控制）
npm run build    # tsup → dist/（库 + openbkn bin）
```

## 帮助系统

每个命令、子命令、孙命令都带分组 `--help`，列出各自的参数与位置参数，
整棵命令树可端到端发现。全深度 `--help` 黄金基线与自洽性测试见
`test/equivalence/`（每个节点都存在，其 `--help` 覆盖自身的参数与位置参数；
用 `BKN_EQUIV_LIVE=1` 真机跑）。

## 许可证

BKN SDK 是 OpenBKN 项目的一部分，采用 **OpenBKN License** —— Apache License 2.0
的修改版，附加若干条件。见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。此前以
Apache-2.0 分发的版本仍按 Apache-2.0 授权。
