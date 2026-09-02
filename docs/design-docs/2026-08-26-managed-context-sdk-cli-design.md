# ContextLoader Receipt 与生命周期继承设计（Issue #68）

> 状态：Proposed — 仅设计评审，未授权实现。
> 基线：`origin/main@9233b17`（2026-08-31）。
> 关联：[SDK #68](https://github.com/openbkn-ai/bkn-sdk/issues/68)；[SDK #88](https://github.com/openbkn-ai/bkn-sdk/issues/88) 跟踪本次 Trace 评审发现的身份隔离缓存缺陷；Foundry #1161 是独立的 Toolbox Trace 问题，不阻塞本设计。

## 1. 决策摘要

ContextLoader 的业务工具调用必须在**同一条调用链**上完成两件事：

1. 继承调用方提供的业务上下文，或依据服务端 catalog 自动建立 `bkn_context`；
2. 原样保留服务端签发、可回读的 Operation Receipt。

本期不新增高层 lifecycle 对象、CLI 子命令或 SDK 公共 API。内部新增结果通路；既有
`toolCall()` 保持只返回业务值，既有 `managedToolCall()` 改为复用该通路并要求 Receipt。
`openbkn context tool-call --receipt --json` 是 CLI 的 opt-in 出口。

所有 MCP transport session、lifecycle catalog / probe 缓存都必须按认证身份隔离。`MCP-Session-Id`
仅是传输状态，绝不是 Conversation、Interaction 或身份的替代品。

### 对外接口影响

本设计的兼容性目标是**不改变既有调用方的成功返回值或 MCP wire contract**；唯一新增的用户
可见能力是显式选择的 CLI flag。具体如下：

| 表面 | 变化 | 兼容性承诺 |
| --- | --- | --- |
| ContextLoader MCP wire schema / 服务端 API | 无 | 不新增字段、不改 `bkn_context` guard、不从 header 或 transport session 推断业务上下文 |
| `client.context.toolCall()` | 无签名或返回类型变化 | 继续返回仅含业务 value 的 `Promise<unknown>`；Receipt 不进入此公开返回值 |
| `client.context.managedToolCall()` | 无签名或返回类型变化；修复其内部调用链 | 继续返回 `{ value, receipt }`；原先因绕过 lifecycle 被拒绝的合法调用将转为成功，这是 bug fix 的预期语义修正 |
| `openbkn context tool-call`（无新 flag） | 无 | 默认文本 / JSON 输出保持当前行为 |
| `openbkn context tool-call --receipt --json` | 新增 opt-in CLI 形式 | 输出稳定 `{ value, bkn_receipt }`；不影响未传 `--receipt` 的脚本 |
| 生命周期错误呈现 | 已知错误改为脱敏操作提示 | 服务端 error code 与退出码不变；仅已知错误的人类可读文本更安全、可行动 |
| 包内 `callToolResult()` | 新内部实现 | 不从 `src/index.ts` 或 resource surface 导出，不能形成新的 npm SDK 契约 |

因此这不是 breaking API change。调用方若要取得 CLI Receipt，必须显式加入 `--receipt --json`；
调用方若继续使用原命令或普通 `toolCall()`，不会突然收到 envelope 或 Receipt 字段。

`--receipt` 的组合契约固定如下，所有输入错误均在发出 MCP 请求前以 `InputError`（exit code 2）
失败：

| 参数组合 | 行为 |
| --- | --- |
| 不含 `--receipt` | 保持现有命令与输出行为 |
| `--receipt --json` | 输出稳定 envelope `{ value, bkn_receipt }` |
| `--receipt --json --compact` | 与上行同一 JSON schema，仅采用单行序列化 |
| `--receipt` 且没有 `--json` | `InputError`：Receipt 只能以机器可读 envelope 输出 |
| `--receipt --schema` | `InputError`：schema 探索不执行工具，二者互斥 |

## 2. 问题与业务影响

ContextLoader 是 Agent、CLI 和应用访问知识网络的 MCP 入口。它服务的并不只是“把一条查询
跑出结果”：供应链 Agent 依据库存与预测决定补货，业务分析 Agent 用 `run_sql` 生成异常清单，
自动化评测将一次查询结果作为后续函数调用或交付结论的依据。这些结果一旦进入下游，就必须能
回答四个问题：**谁**在什么业务 Conversation 中提出了**哪一轮**问题、这次工具调用对应哪个
Operation、以及当前身份能否回读服务端认可的执行事实。

没有 Receipt 时，CLI 或 SDK 仍可把 `value` 打印给用户；但脚本只持有一段脱离上下文的 JSON：
它无法可靠地区分“同一个对话的上一轮结果”“另一个身份的结果”或“失败后被重放的旧结果”。
下游只能猜测 request id、MCP connection 或时间邻近关系，而这些都不是业务归属契约。Receipt
把该猜测替换为可回读的服务端引用，因此是审计、评测、可追溯交付和多工具编排的最小闭环。

```text
供应链 Agent："本周哪些供应商有断供风险？"
  → ContextLoader 查询库存、订单和预测
  → value：风险供应商列表
  → Receipt：此列表属于 conv_123 / int_456 / op_789，且由当前身份可回读
  → 后续补货工具、Trace 审计或 benchmark 以 receipt_id 验证，而不信任脚本内存中的 JSON
```

这项工作不改变数据查询本身、也不把 Receipt 变成授权令牌；它补齐的是**结果从产生到被采用**
之间的可信归属。一次性、人工阅读的查询通常不受阻；需要跨进程、跨工具或事后审计的业务则会
失去可验证性。

```text
用户问题 → Agent / CLI 调用 ContextLoader 业务工具 → 服务端返回 value + Receipt
                                                     → 当前身份以 receipt_id 回读 Trace / Operation
                                                       验证归属与状态
```

Receipt 是服务端签发的证据引用，不是 bearer credential。跨不可信边界不得信任或转发其 JSON
作为授权事实；需要权威判断时，当前身份必须以 `receipt_id` 回读。

主线已具备普通 `toolCall()` 的大部分生命周期处理，但仍有以下断点：

- `unwrapToolResult()` 读取 `structuredContent.bkn_receipt` 后，`toolCall()` 立即丢弃 Receipt；
- CLI 的 `context tool-call` 没有 Receipt 输出通道；
- `managedToolCall()` 直接发 MCP 请求，绕过 `withManagedLifecycle()`，在强制 lifecycle 的部署中会因缺少 `bkn_context` 被拒绝；
- terminal replay / receipt pending 可能在 `structuredContent.receipt` 返回，当前解析不覆盖；
- 单独传入 `BKN_INTERACTION_ID` 会落入自动 handshake，而不是明确拒绝，可能使证据归属漂移；
- MCP transport session 和 catalog 能力缓存没有完整按身份分区，长期 SDK 进程切换身份时存在错误复用风险（独立跟踪于 [#88](https://github.com/openbkn-ai/bkn-sdk/issues/88)）。

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

一次 MCP 请求只能携带一套业务 Conversation / Interaction。调用方已经提供
`args.bkn_context` 时，SDK 对 `ClientOptions.trace` / CLI 解析出的业务 IDs 采取以下规则：

- Trace 中没有业务 IDs：保留 request ID、traceparent 等技术追踪 headers，但不发送业务
  Conversation / Interaction headers；
- Trace 中的 Conversation / Interaction 与 `bkn_context` 完全相同：可发送相同业务 headers；
- Trace 中任一已提供业务 ID 与 `bkn_context` 不同，或只有其中一个 ID：本地 `InputError`，不发出
  MCP 请求。

这样 `arguments.bkn_context`、MCP span 和 Trace 回读不会为同一次业务调用写入两条不同的业务链。

### 4.3 Receipt 验证与状态

TypeScript 的 `OperationReceipt` interface 不是运行时验证。Receipt 成功路径至少验证：

- `receipt_id`、`conversation_id`、`interaction_id`、`operation_id` 为非空字符串；
- `receipt_status` 为当前 SDK `OperationReceipt` union 中的 `pending`、`completed` 或 `failed`；
  未知状态安全失败，不能按 pending 或 completed 猜测；
- 如果 SDK 注入了 `bkn_context`，Receipt 的 Conversation / Interaction 必须与注入值一致；
- caller 自带 `bkn_context` 时，Receipt 的 Conversation / Interaction 也必须与该 context 一致。

不满足上述条件是 integrity failure，不能打印或返回为可信 Receipt。这里区分两个强度：

- **validated receipt**：本次 MCP 响应的结构、允许状态以及与实际 context 的关联一致；CLI
  `--receipt --json` 只输出这一层。
- **authorized receipt evidence**：当前身份随后以 `receipt_id` 调用权威 `getReceipt` / MCP
  `bkn_get_receipt` 成功，且回读的 `receipt_id`、Conversation、Interaction、Operation 和
  `payload_hash`（服务端提供时）与初始 Receipt 一致。跨进程、审计、交付或下游采用必须以这一层
  为准；不得用 token 哈希推断 owner，也不得信任别的进程传来的 Receipt JSON。

解析必须只接受以下状态机：

| 响应情形 | 稳定载体 | 行为 |
| --- | --- | --- |
| 正常业务完成 | `structuredContent.bkn_receipt` | 返回业务 value 与 Receipt |
| terminal replay，响应含可解析 content value | `structuredContent.receipt` | 返回该 value 与 Receipt，不重执行业务工具 |
| terminal replay，响应未含 value | `structuredContent.receipt` | 返回 `value: null` 与 Receipt；本期不声称可由 Receipt 恢复业务结果 |
| receipt pending | `structuredContent.receipt` | 返回 `value: null` 与 Receipt；调用方按 `receipt_id` 回读，禁止重试业务工具 |
| failed | MCP error 载体及可选 Receipt | 抛固定错误；不得返回或伪造业务 value。若服务端给出可验证 Receipt，只供当前身份的受控诊断/回读使用 |

若产品未来需要“按 Receipt 回读业务结果”，必须先定义并部署权威结果读取 API；本期不从
`OperationReceipt` 推断或重建 value。不得把任意 `structuredContent.receipt` 或普通 structured
content 强转为 Receipt。

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

身份 key 使用带命名空间的单向哈希，例如 `sha256("bkn-context-cache:v1\\0" + token)` 的短前缀；
仅可作为进程内 Map key，绝不进入日志、诊断文本或 metric label。凭据刷新后必须按新 token
重新计算 key，不能复用旧 credential 的 transport session 或 catalog 结论。

### 4.6 最小可观测性与隐私边界

本期不新增 SDK 对外 telemetry / metrics API，也不把客户端数据发送到新的观测服务。发布与 E2E
必须从现有受控测试 harness 与服务端 Trace 采集下列**计数**，以定位生命周期回归：

- `context_receipt_result_total{disposition=completed|replay|pending|failed|missing|invalid}`；
- `context_lifecycle_retry_total{reason=stale_session}`；
- `context_identity_cache_partition_total{cache=session|catalog}`；
- `context_receipt_authorized_readback_total{outcome=success|denied|mismatch}`。

标签只允许固定枚举、部署版本和工具类别；不得包含 token、完整 Receipt / Conversation /
Interaction / Operation ID、query、参数、业务 value 或服务端 raw error。需要受控关联时使用有
明确保留期的单向短哈希，且该哈希不出现在 CLI stdout/stderr。

## 5. 验收矩阵

### 单元与 CLI 集成测试

- caller 自带 `bkn_context` 原样发送，并保留经过验证的 Receipt；与 Trace IDs 冲突时不覆盖；
- 完整 Conversation + Interaction 投影到 `bkn_context`，Receipt 与其一致；仅 Conversation 时在该 Conversation start 新 Interaction；无上下文时按 catalog handshake；
- interaction-only（SDK trace、CLI flag 或 env）零 MCP 请求并得到 `InputError`；
- lifecycle 工具不递归注入；SDK-owned stale session 只重开一次；caller-owned terminal 不重开；
- `managedToolCall()` 无手工 context 时仍自动注入并返回 Receipt；Receipt 缺失或畸形时失败；`toolCall()` 返回值保持兼容；
- normal `bkn_receipt`、terminal replay `receipt`、pending `receipt` 都覆盖；pending 的业务调用次数恰为一；
- `--receipt --json` envelope 固定；默认 `tool-call` 输出兼容；已知错误的 raw 文本含 query 时输出仍不泄露 query；
- `--receipt` 的所有参数组合按本设计真值表处理，且 schema / 输入错误路径 MCP 调用数为零；
- 同 host / KN、不同 token 得到不同 MCP transport session 和 catalog probe；token 不出现在缓存键或日志。

### 真实 E2E

1. 身份 A start `conv_1/int_1`；新 CLI 进程带 `BKN_CONVERSATION_ID` 和
   `BKN_INTERACTION_ID` 执行 `tool-call --receipt --json`；以当前身份回读 Receipt，断言 IDs 一致。
2. finish `int_1`；在同一 `conv_1` start `int_2`；新 CLI 进程替换 Interaction 后重复，断言
   Conversation 相同、Interaction 不同。
3. 旧 `int_1` 被稳定拒绝且不会自动另开会话；replay / pending 验证下游业务工具恰执行一次。
4. 身份 B 无法续接 A 的 Conversation、读取 A 的 Receipt 或使用 A 的 `bkn_context` 执行业务工具；
   每项断言无 value、owner、Receipt 泄露且下游执行次数为零。身份 A 仍可回读其 Receipt。
5. 服务端故障注入：业务工具已执行并记录 Operation / side-effect count 后，故意在首个响应前断开。
   客户端恢复时只能回读 Receipt，不能发送第二个 `tools/call`；断言 server-side execution count 为 1、
   Operation ID / attempt / Receipt ID 稳定。普通 mock 不能替代该证明。
6. 构造 caller `bkn_context` 与 Trace headers 冲突的请求；断言本地拒绝且没有双重业务 context。
   对成功路径，Receipt、MCP span 和 `trace get` 的 Conversation / Interaction / Operation 必须可 join。
7. 触发每种 disposition、stale retry、identity partition 与授权回读结果，核验受控计数增长，并扫描
   stdout、stderr、日志和 metric label 不包含敏感值。

## 6. 实施前门禁与跟踪

本设计 PR 只提供审核材料，不能视为实现授权。开始任何代码工作前，Owner 必须：

1. 审核并批准 #68 与 #88 的可测试 AC，应用 `ac-approved`；
2. 确定 #88 是并入 #68 的同一实现 PR，还是独立修复；再将可实施、所有权明确的 Issue 标记
   `agent-ready`；
3. 在 `docs/exec-plans/active/` 创建实施计划，逐条映射 #68/#88 AC 到文件、测试、真实 E2E
   和发布 / 回滚证据；
4. 明确未来实现 PR 的关闭关系：若同一 PR 覆盖两项，使用 `Closes #68, Closes #88`；否则分别
   指向对应 Issue。

实施计划还必须决定并记录：`cli-command-design.md`、CLI help contract、README / README.zh、
`skills/openbkn/references/context.md`、`docs/product-specs/bkn-trace.md` 是否需要同步更新；任何
“不需要更新”的结论也必须写明理由。PR #87 不使用 `Closes`，因为它没有实现 #68 或 #88。

## 7. 风险、回滚与发布门槛

风险集中在服务端 lifecycle v1/v2 的真实 catalog 与跨身份授权语义，不能由 mocked unit test
替代。实施不得硬编码一种 schema；运行时 catalog 与真实 MCP 响应优先。该改动只在 `--receipt`
或既有 `managedToolCall()` 需要 Receipt 的调用中暴露新失败；普通 SDK / CLI 调用保持兼容。

实现不涉及数据迁移、服务端配置或 Receipt schema 变更。若真实 E2E、灰度或发布后发现不兼容，
停止发布或回退 npm 版本 / release 到前一版本；不得依赖服务端开关或手工清缓存作为回滚方案。
`--receipt` 可随版本回退移除，普通 `toolCall()` 的既有输出不受影响；对
`managedToolCall()` 的 bug-fix 回退必须明确记录会重新暴露强制 lifecycle 部署上的失败风险。

发布门槛为 lint、unit test、两轮跨进程 E2E、跨身份负向 E2E、响应丢失故障注入 E2E 全部通过，
并记录 authorized receipt evidence 与脱敏观测计数。
