# bkn-sdk / openbkn CLI BKN Trace 接入规范

> 状态：OpenBKN 0.1.4 Managed Trace 调用事实合同

## 责任边界

- 业务 SDK 的参数与返回结构不因 Trace 改变。
- `ManagedTrace` 在调用边界记录实际输入、实际输出或实际异常。
- Trace Core 按 `operation_id + attempt` 保存调用事实；SDK 不计算 Trace 输入或输出哈希。
- Managed Trace 生产的调用事实标记为 `sdk / managed-trace-sdk`；业务 payload 保持不透明。
- SDK 只生产技术调用事实，不解释 BKN 对象、关系、指标、行动或优化建议。

## 受管调用

```ts
const result = await interaction.runOperation(
  {
    operationKey: "purchase-orders-by-material",
    toolName: "run_sql",
    input: {
      sql: "SELECT * FROM {{.purchase_orders}} WHERE material_number = '101-000015'",
    },
  },
  async ({ context }) => invokeBusinessApi(context),
);
```

包装器在 execute 前 ensure Operation；重试时先申请新 attempt，再 ensure 领取执行权。Core 返回 `execute=false` 时不执行业务回调。成功时把 execute 的返回值作为 `output`，失败时把原异常转换为结构化 `error`。execute 的返回对象保持不变，抛出的错误对象也保持不变。Trace 终态写入失败不能覆盖已经产生的业务结果或异常；调用方可通过 `ManagedTraceOptions.onTraceError` 接收失败，并通过返回 Receipt 的 `receipt_status` 判断终态是否持久化。

输入、输出和错误采用固定 1 MiB 的 `PayloadEnvelope`：阈值内为 `inline`，超限为 `omitted / payload_too_large`，无法 JSON 序列化时为 `omitted / serialization_failed`。SDK 不自动创建新的大对象存储。

## Trace Context

调用方可通过 `ClientOptions.trace` 传入 `requestId`、`traceparent`、`conversationId`、`interactionId` 和 allowlist baggage。缺失或非法的 request id / W3C traceparent 由 SDK 生成。所有 OpenBKN HTTP 请求传播：

- `traceparent`
- `bkn-request-id`
- `x-request-id`
- 调用方显式提供时的 `bkn-conversation-id`、`bkn-interaction-id`
- baggage allowlist：`bkn.account.type`、`bkn.runtime.env`

## CLI 读取

```bash
openbkn trace get <conversation-id> --json
openbkn trace detail <trace-id> --json
openbkn trace interactions operations <interaction-id> --json
openbkn trace operations attempt <operation-id> <attempt> --json
```

`--json` 原样输出 `PayloadEnvelope`，不截断 inline 内容，也不把 `omitted` 表示成空结果。

## 从旧 Managed Trace 迁移

- `normalizedInputHash` 改为 `input`，传真实调用参数。
- execute 回调从 `{ value, receipt }` 改为直接返回业务结果；Receipt 终态由包装器提交。
- 低层 lifecycle ensure 的 `normalized_input_hash` 改为 `input`。
- 低层 lifecycle complete/fail 的 `payload_hash` 改为 `output` / `error`。

旧 Trace 写入合同不保留双调用路径。

## 验证

```bash
npm run lint
npm test
npm run build
```
