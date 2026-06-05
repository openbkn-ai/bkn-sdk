# @openbkn/bkn-sdk

BKN（Business Knowledge Network）平台的统一 TypeScript SDK + CLI。一套工具、两个入口：
可 import 的 SDK 与 `openbkn` 命令行——共享同一套领域逻辑。这是对旧版
`kweaver-sdk` + `kweaver-admin` 的精简重写，合并为一个包（运维 CLI 收进
`openbkn admin` 子命令）。纯后端，无 Web UI。

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

# 运维（kweaver-admin，嵌套）
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

## 与旧 CLI 的一致性

`openbkn` 对齐已安装的 `kweaver` / `kweaver-admin` 命令树
（`kweaver <x>` → `openbkn <x>`，`kweaver-admin <x>` → `openbkn admin <x>`）。
全深度 `--help` 黄金基线与一致性测试见 `test/equivalence/`
（用 `BKN_EQUIV_LIVE=1` 真机跑）。

## 许可证

Apache-2.0
