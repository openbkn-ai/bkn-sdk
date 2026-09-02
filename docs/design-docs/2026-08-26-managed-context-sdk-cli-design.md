# ContextLoader Receipt 与生命周期继承设计（Issue #68）

> 状态：Proposed — 仅设计评审，未授权实现。
> 基线：`origin/main@9233b17`（2026-08-31）。
> 关联：[SDK #68](https://github.com/openbkn-ai/bkn-sdk/issues/68)；Foundry #1161 是独立的 Toolbox Trace 问题，不阻塞本设计。

## 1. 决策摘要

ContextLoader 的业务工具调用必须在**同一条调用链**上完成两件事：

1. 继承调用方提供的业务上下文，或依据服务端 catalog 自动建立 `bkn_context`；
2. 原样保留服务端签发、可回读的 Operation Receipt。

本期不新增高层 lifecycle 对象、CLI 子命令或 SDK 公共 API。内部新增结果通路；既有
`toolCall()` 保持只返回业务值，既有 `managedToolCall()` 改为复用该通路并要求 Receipt。
`openbkn context tool-call --receipt --json` 是 CLI 的 opt-in 出口。

所有 MCP transport session、lifecycle catalog / probe 缓存都必须按认证身份隔离。`MCP-Session-Id`
仅是传输状态，绝不是 Conversation、Interaction 或身份的替代品。

## 2. 问题与业务影响

ContextLoader 是 Agent、CLI 和应用访问知识网络的 MCP 入口。供应链 BOM/库存/预测查询、
`run_sql`、多工具 Agent 编排、benchmark 以及审计，都需要证明一份结果属于某个业务对话、
当前用户问题、调用身份与具体 Operation。

```text
用户问题
  → Agent / CLI 调用 ContextLoader 业务工具
  → 服务端返回 value + Receipt
  → 当前身份以 receipt_id 回读 Trace / Operation，验证归属与状态
```

Receipt 是服务端签发的证据引用，不是 bearer credential。跨不可信边界不得信任或转发其 JSON
作为授权事实；需要权威判断时，当前身份必须以 `receipt_id` 回读。

主线已具备普通 `toolCall()` 的大部分生命周期处理，但仍有以下断点：

- `unwrapToolResult()` 读取 `structuredContent.bkn_receipt` 后，`toolCall()` 立即丢弃 Receipt；
- CLI 的 `context tool-call` 没有 Receipt 输出通道；
- `managedToolCall()` 直接发 MCP 请求，绕过 `withManagedLifecycle()`，在强制 lifecycle 的部署中会因缺少 `bkn_context` 被拒绝；
- terminal replay / receipt pending 可能在 `structuredContent.receipt` 返回，当前解析不覆盖；
- 单独传入 `BKN_INTERACTION_ID` 会落入自动 handshake，而不是明确拒绝，可能使证据归属漂移；
- MCP transport session 和 catalog 能力缓存没有完整按身份分区，长期 SDK 进程切换身份时存在错误复用风险。

因此这是 P1 的证据链正确性问题：通常不阻断一次性查询结果，但会阻断可审计、可验证、可编排的业务闭环。它不是已证实的数据面越权；跨身份服务端拒绝仍须真实 E2E 验证。

## 3. 范围与边界

### 目标

- 保持自动 `bkn_context` 注入、caller-owned context 原样透传和 SDK-owned stale session 单次恢复；
- 让 SDK 的既有 Receipt 入口和 CLI Receipt 输出都走上述同一调用链；
- 对 normal、terminal replay、pending 三种稳定 Receipt 载体给出明确行为；
- 明确 Conversation 可跨轮、Interaction 仅当前轮有效的 CLI 使用规则；
- 使跨身份 transport session 与 capability 判断互不复用；
- 提供不会回显 query、参数、结果或凭据的生命周期诊断。

### 非目标

- 不修改 ContextLoader MCP wire schema、服务端 `bkn_context` guard 或 Receipt schema；
- 不允许服务端从 HTTP headers、`MCP-Session-Id`、问题文本或 Agent 名推断业务上下文；
- 不新增 `ContextInteraction`、本地持久化 session handle、`context managed-tool-call` 命令或新的 SDK Receipt API；
- 不改变普通 `toolCall()`、普通 CLI JSON 输出，或把 Receipt 原始 JSON 当作跨身份授权输入；
- 不处理 Foundry #1161 的 Toolbox 函数独立 Trace。

## 4. 调用链与契约

### 4.1 单一内部结果通路

`src/api/context-loader.ts` 增加**包内** `callToolResult()`。它不是 SDK 导出，也不作为新的
resource 方法暴露。

```text
callToolResult(ctx, knId, name, args, options)
  ├─ lifecycle 工具 → raw MCP call（禁止递归）
  ├─ args.bkn_context 已存在 → 原样发送（不补写、不覆盖）
  └─ 其他业务工具 → withManagedLifecycle(...)
                         → 自动注入 bkn_context / stale 时最多重开一次
  → runtime-validated { value, receipt?, disposition }

toolCall()        → callToolResult(...).value
managedToolCall() → callToolResult(...); 无可信 receipt 则失败
CLI --receipt     → client.context.managedToolCall(...)
```

CLI 必须调用修复后的既有 `client.context.managedToolCall()`，而非 command 层直接 import API
模块或访问 `client.ctx`。这保持 `commands → resources → api` 的分层，并且不增加公开 SDK
surface；文档与样例不把 `managedToolCall()` 推广为普通调用的首选入口。

`toolCall()` 的参数、返回类型和业务输出保持不变。`managedToolCall()` 的公开签名也保持不变，
但修复其实际生命周期继承。

### 4.2 上下文优先级与生命周期

对于非 lifecycle 工具，优先级如下：

```text
args.bkn_context（完整 caller-owned，对 trace 冲突时仍原样优先）
  > SDK ClientOptions.trace 的完整 conversation_id + interaction_id
  > CLI 显式 --conversation-id / BKN_CONVERSATION_ID（仅 Conversation，可 start 当前 Interaction）
  > CLI 已记住的 Conversation
  > 服务端 catalog 驱动的自动 handshake
```

`BKN_INTERACTION_ID` / `--interaction-id` 不得单独存在：必须同时解析到同源 Conversation，
否则在任何 MCP 请求前抛出 `InputError`。Interaction 在 finish 后立即失效，不能写入 shell
profile、共享 `.env` 或长期 CI；下一用户问题必须 start 新 Interaction。Conversation 可以跨该
业务对话的多轮延续。

对 caller-owned 完整 context 或完整 Trace ID，terminal / required 错误必须原样失败，绝不能
静默创建别的 Conversation 或 Interaction。仅 SDK 自己创建的 session 可基于明确 stale code
重开一次。

### 4.3 Receipt 验证与状态

TypeScript 的 `OperationReceipt` interface 不是运行时验证。Receipt 成功路径至少验证：

- `receipt_id`、`conversation_id`、`interaction_id`、`operation_id` 为非空字符串；
- `receipt_status` 为服务端定义的允许状态；
- 如果 SDK 注入了 `bkn_context`，Receipt 的 Conversation / Interaction 必须与注入值一致；
- caller 自带 `bkn_context` 时，Receipt 的 Conversation / Interaction 也必须与该 context 一致。

不满足上述条件是 integrity failure，不能打印或返回为可信 Receipt。解析必须只接受：

| 响应情形 | 稳定载体 | 行为 |
| --- | --- | --- |
| 正常业务完成 | `structuredContent.bkn_receipt` | 返回业务 value 与 Receipt |
| terminal replay | `structuredContent.receipt` | 返回服务端给出的稳定结果 / Receipt，不重执行业务工具 |
| receipt pending | `structuredContent.receipt` | 返回 `value: null` 与 Receipt；调用方按 `receipt_id` 回读，禁止重试业务工具 |

不得把任意 `structuredContent.receipt` 或普通 structured content 强转为 Receipt。

### 4.4 CLI 输出与诊断

仅当用户传入 `--receipt --json` 时，`openbkn context tool-call` 输出稳定 envelope：

```json
{
  "value": { "rows": [] },
  "bkn_receipt": { "receipt_id": "rcpt_..." }
}
```

无 `--receipt` 时，输出必须与当前主线兼容。带 `--receipt` 但响应缺少或无法验证 Receipt 时命令
失败，不能退化为仅打印 value。对 catalog 已确认不支持 lifecycle 的部署，仍以实际响应是否包含
可信 Receipt 为准；catalog unknown 时，`--receipt` 必须在发送业务请求前失败，普通 `toolCall()`
维持既有兼容性降级。

`interaction_terminal`、`interaction_required`、`conversation_required`、
`conversation_context_conflict` 和 lifecycle schema mismatch 使用固定、脱敏的 code-to-hint
文案。已知错误不得回显服务端 raw 文本、查询条件、工具参数、业务行或凭据；未知错误维持既有
兼容行为。

### 4.5 身份与缓存隔离

缓存键不得保存 bearer token 原文，使用 token 的短哈希。至少满足：

| 缓存 | 必须包含的键维度 |
| --- | --- |
| MCP transport session | base URL、KN ID、认证身份 |
| lifecycle business session | base URL、KN ID、认证身份、调用方明确指定的 Conversation（如有） |
| catalog contract / probe 状态 | base URL、认证身份 |

不同身份不得复用 MCP session、能力探测结论、Conversation、Interaction 或 Receipt。服务端仍是
最终授权方；客户端分区是防御性保证，避免错误归属和会话绑定主体混淆。

## 5. 验收矩阵

### 单元与 CLI 集成测试

- caller 自带 `bkn_context` 原样发送，并保留经过验证的 Receipt；与 Trace IDs 冲突时不覆盖；
- 完整 Conversation + Interaction 投影到 `bkn_context`，Receipt 与其一致；仅 Conversation 时在该 Conversation start 新 Interaction；无上下文时按 catalog handshake；
- interaction-only（SDK trace、CLI flag 或 env）零 MCP 请求并得到 `InputError`；
- lifecycle 工具不递归注入；SDK-owned stale session 只重开一次；caller-owned terminal 不重开；
- `managedToolCall()` 无手工 context 时仍自动注入并返回 Receipt；Receipt 缺失或畸形时失败；`toolCall()` 返回值保持兼容；
- normal `bkn_receipt`、terminal replay `receipt`、pending `receipt` 都覆盖；pending 的业务调用次数恰为一；
- `--receipt --json` envelope 固定；默认 `tool-call` 输出兼容；已知错误的 raw 文本含 query 时输出仍不泄露 query；
- 同 host / KN、不同 token 得到不同 MCP transport session 和 catalog probe；token 不出现在缓存键或日志。

### 真实 E2E

1. 身份 A start `conv_1/int_1`；新 CLI 进程带 `BKN_CONVERSATION_ID` 和
   `BKN_INTERACTION_ID` 执行 `tool-call --receipt --json`；以当前身份回读 Receipt，断言 IDs 一致。
2. finish `int_1`；在同一 `conv_1` start `int_2`；新 CLI 进程替换 Interaction 后重复，断言
   Conversation 相同、Interaction 不同。
3. 旧 `int_1` 被稳定拒绝且不会自动另开会话；replay / pending 验证下游业务工具恰执行一次。
4. 身份 B 无法续接 A 的 Conversation、读取 A 的 Receipt 或使用 A 的 `bkn_context` 执行业务工具；
   每项断言无 value、owner、Receipt 泄露且下游执行次数为零。身份 A 仍可回读其 Receipt。

## 6. 风险、回滚与发布门槛

风险集中在服务端 lifecycle v1/v2 的真实 catalog 与跨身份授权语义，不能由 mocked unit test
替代。实施不得硬编码一种 schema；运行时 catalog 与真实 MCP 响应优先。该改动只在 `--receipt`
或既有 `managedToolCall()` 需要 Receipt 的调用中暴露新失败；普通 SDK / CLI 调用保持兼容。

回滚方式是回退本 PR；它不涉及数据迁移、服务端配置或 Receipt schema 变更。发布门槛为 lint、
unit test、两轮跨进程 E2E、跨身份负向 E2E 全部通过，并记录可回读 Receipt 证据。
