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

业务响应丢失时，SDK 查询同一 Receipt，不直接重放副作用。只有 Core 将失败 Operation 标记为 retryable 时，SDK 才能在调用方配置的 `maxAttempts` 上限内创建下一 attempt。恢复回执必须与原 `receipt_id + operation_id + attempt + operation_key + normalized_input_hash` 完全一致。

Operation Receipt 中的 `observed_evidence_refs` 只是候选。调用方必须在每个 Claim 的 `supports[]` 中逐项标记 `adopted` 或 `rejected`，并固定来源 Interaction、revision、operation、version、content hash 和 fragment selector；SDK 不自动采用全部 observed refs。

## 公共接口

- `client.trace.lifecycle`：Conversation、Interaction、Operation、Receipt 的低层 3.0 API。
- `client.trace.withInteraction`：第三方 Agent 的高层受管包装。
- `client.trace.graph`、`client.trace.spans`：技术 Trace 定位。
- `client.trace.search/diagnose/scan/evalSet*`：技术 Trace 分析与测试工具。

Community 制品不分发 2.x Evidence 写入 Session、Artifact 正文读写、业务证据链、业务语义图或快照解释实现。业务解释与内容 Resolver 属于受许可 EE 扩展；2.x 数据只作为服务端历史读取与迁移对象。

## CLI

- `openbkn trace conversations list|get|ensure-current|create-new-generation|resume|close`
- `openbkn trace interactions start|get|complete|fail|cancel|handoff`
- `openbkn trace operations get|retry`
- `openbkn trace receipts get`
- `openbkn trace graph|get|search|diagnose|scan`

Interaction 终止 manifest 和 Operation retry fencing 字段通过 `--body` 或受保护的 `--body-file` 提交。lease token 不进入命令行参数，避免出现在 shell history 或进程列表。

## 完成标准

- 稳定外部会话键的并发 ensure 只形成一个 Core generation，调用方自报 generation 或身份字段被拒绝。
- 包装层只终止一次；complete 响应丢失时查询权威 Interaction，并以相同 terminal idempotency key 最多重放一次 complete，不能反向 fail。
- 不可重试失败会终止本轮；可重试失败创建新的 Core attempt，不产生第二次已成功副作用。
- 不同 Claim 只采用各自的精确 supports，observed refs 不自动 adopted。
- 公共 SDK 不缓存、打印或写普通日志中的 Artifact 正文和敏感字段。
- 在 `#541`、`#544`、`#542/#546` 就绪后，用真实第三方 Agent 完成三轮 Conversation E2E；测试不得手工构造证据冒充真实验收。
