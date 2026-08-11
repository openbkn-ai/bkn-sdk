# BKN Trace：SDK 与第三方 Agent

## 目标

第三方 Agent 或 AI 应用调用 OpenBKN 时，默认形成受管 Conversation、每轮 Interaction、每次 Operation、稳定 Receipt、技术 Trace 和精确 Claim supports。调用方不手工拼接 Evidence Event，也不能根据连接、进程、问题文本或时间邻近猜测会话和证据关系。

## 受管生命周期

`client.trace.withInteraction(...)` 是第三方 Agent 的默认入口。调用方必须显式选择一种 Conversation 归属：

- `resume_by_id`：恢复已有且有权访问的 Conversation。
- `ensure_current`：按稳定 `externalConversationKey` 幂等取得当前 generation。
- `one_shot`：每次创建独立临时 Conversation。
- `create_new_generation`：显式开始下一 generation。

generation、owner、tenant、应用主体、effective subject 和 delegation 由 Core 与可信认证上下文确定。SDK 拒绝调用方在 JSON 中自报这些身份字段。

包装层负责开始 Interaction、唯一终止、回调异常时 fail、显式 cancel/handoff 去重，以及进程异常后由服务端 lease recovery 标记 abandoned。同一 SDK 实例不允许同一 Conversation 并行两个 active Interaction；跨进程冲突由 Core 权威约束。

## Operation 与 Receipt

`interaction.runOperation(...)` 在业务调用前幂等注册 Operation，并向业务调用显式传递：

```json
{
  "bkn_context": {
    "conversation_id": "conversation_...",
    "interaction_id": "interaction_...",
    "operation_key": "稳定逻辑调用键",
    "parent_operation_id": "operation_...",
    "causation_event_ids": ["event_..."]
  }
}
```

调用方在 `runOperation` 中提交真实 `input`，execute 回调只返回业务结果或抛出实际异常。包装器在成功时提交实际输出，在失败时提交异常名称、消息、错误码、阶段与可重试性；调用方不计算输入或输出哈希。Managed Trace 固定记录 `protocol=sdk` 和 `source_module=managed-trace-sdk`，这两个字段是 Trace 生产者身份，不是业务 SDK 参数。

execute 抛出的错误默认不可重试。只有错误对象明确携带 `retryable: true`（调用方确认该操作可安全重放）或 Core 已存在的失败 Operation 已被标记为 retryable 时，SDK 才能在调用方配置的 `maxAttempts` 上限内创建下一 attempt，并必须再次 ensure 领取 Core 的执行授权。Core 返回 `execute=false`、已完成 Receipt 或未授权的 pending attempt 时都不重放业务调用。业务调用完成后若 Trace 终态写入失败，SDK 保留原业务返回或原异常，不用可观测性故障改写业务行为。

Operation Receipt 中的 `observed_evidence_refs` 只是证据引用 ID 候选。SDK 不会自动将它们采用为 Claim 支撑；需要生成 Claim 时，调用方应先读取对应证据，再明确写入来源 Interaction、revision、operation、version、content hash 和 fragment selector。

## 公共接口

- `client.trace.lifecycle`：Conversation、Interaction、Operation、OperationCallFact 与 Receipt 的低层 API。
- `client.trace.withInteraction`：第三方 Agent 的高层受管包装。
- `client.trace.search`：通过时间、状态、服务、工具、Trace ID 和错误关键词查询类型化 Trace 摘要，不接受原始查询 DSL。
- `client.trace.get`：读取单个 Trace 的用户问题、业务结果摘要、Span 与 Operation 原始调用事实。
- `client.trace.graph`、`client.trace.spans`：技术 Trace 定位。
- `client.trace.diagnose/scan/evalSet*`：技术 Trace 分析与测试工具。

Community 制品不分发 2.x Evidence 写入 Session、Artifact 正文读写、业务证据链、业务语义图或快照解释实现。业务解释与内容 Resolver 属于受许可 EE 扩展；2.x 数据只作为服务端历史读取与迁移对象。

## CLI

- `openbkn trace conversations list|get|ensure-current|create-new-generation|resume|close`
- `openbkn trace interactions start|get|operations|complete|fail|cancel|handoff`
- `openbkn trace operations get|attempt|retry`
- `openbkn trace receipts get`
- `openbkn trace graph|get|search|diagnose|scan`

Interaction 终止 manifest 和 Operation retry fencing 字段通过受保护的 `--body-file` 提交。lease token 不进入命令行参数，避免出现在 shell history 或进程列表。

## 完成标准

- 稳定外部会话键的并发 ensure 只形成一个 Core generation，调用方自报 generation 或身份字段被拒绝。
- 包装层只终止一次；complete 响应丢失时查询权威 Interaction，并以相同 terminal idempotency key 最多重放一次 complete，不能反向 fail。
- 不可重试失败会终止本轮；可重试失败创建新的 Core attempt，不产生第二次已成功副作用。
- 每个 Operation attempt 可以回读真实输入以及真实输出或结构化错误。
- 不同 Claim 只采用各自的精确 supports，observed refs 不自动 adopted。
- 公共 SDK 不缓存、打印或写普通日志中的 Artifact 正文和敏感字段。
- 在 `#541`、`#544`、`#542/#546` 就绪后，用真实第三方 Agent 完成三轮 Conversation E2E；测试不得手工构造证据冒充真实验收。
