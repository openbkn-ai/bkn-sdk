# bkn-sdk / openbkn CLI BKN Trace 接入规范

> 状态：BKN Trace 2.1 业务事件接入基线
> 默认写入版本：`bkn.trace.schema.version=2.1.0`
> 兼容读取/校验：`1.0.0`、`2.0.0`、`2.1.0`

## 模块身份

- 模块：`sdk-cli`
- 观测对象：使用 SDK/CLI 调用 OpenBKN 的第三方 Agent 和 AI 应用
- 职责：传播统一 Trace Context，并显式记录业务事实、结论、证据、业务引用和 Action 生命周期
- 非职责：SDK 不根据普通 HTTP 返回内容猜测或自动生成业务结论

## Trace Context

调用方可通过 `ClientOptions.trace` 传入 `requestId`、`traceparent`、`conversationId`、`interactionId` 和 allowlist baggage。缺失或非法的 request id / W3C traceparent 会由 SDK 生成。所有 OpenBKN HTTP 请求传播：

- `traceparent`
- `bkn-request-id`
- `x-request-id`
- 调用方显式提供时的 `bkn-conversation-id`、`bkn-interaction-id`
- baggage allowlist：`bkn.account.type`、`bkn.runtime.env`

conversation/interaction 是调用方拥有的生命周期标识，格式为 `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`。SDK 只校验和传播，缺失或非法时不生成替代值；普通长生命周期 SDK Client 也不读取环境变量，避免把后续所有请求冻结到同一交互。CLI 层按全局 `--conversation-id` / `--interaction-id` 参数优先、`BKN_CONVERSATION_ID` / `BKN_INTERACTION_ID` 环境变量次之解析，一次 CLI 进程只代表一次调用。

SDK 当前不自行启动 OpenTelemetry span；服务端 span、日志和业务事件通过同一 `trace_id` 与 `bkn.request.id` 关联。

### 出站传播

| 目标 | 协议 | 传播字段 | 约束 |
| --- | --- | --- | --- |
| OpenBKN API | HTTP | `traceparent`、`bkn-request-id`、`x-request-id`，以及调用方提供的 conversation/interaction | baggage 只允许 `bkn.account.type`、`bkn.runtime.env` |
| BKN Trace Evidence API | HTTP | 同上；事件批次另带自己的 `trace` 和 `events` | 不自动推断结论或业务引用 |
| Raw call | HTTP | 生成上下文和调用方显式 headers | 显式 headers 可用于调试覆盖；不得记录凭据 |

## 业务事件

`client.trace.createSession(...)` 或 `new TraceSession(...)` 提供强类型的 2.1 记录入口：

1. `startInteraction`：记录用户/任务意图的 hash 和运行模式。
2. `observeOperation`：记录检索、知识读取、数据查询、模型调用、工具调用等业务操作事实。
3. `createClaim`：创建结论，并校验引用的 event/operation 必须属于当前 session。
4. `createEvidenceRefs`：把结论关联到受控证据引用和版本。
5. `resolveBusinessRefs`：把结论还原到本体对象、属性、关系、指标、逻辑或行动。
6. Action API：强制 `recommended → approval_requested → approved|rejected → executed → result_recorded`；未批准不得执行，拒绝后不得继续。
7. `flush`：批量提交；失败时保留原 event id，可安全重试。

底层 `client.trace.emitEvidenceEvents(body)` 保留给框架和高级调用方，但新接入应优先使用 `TraceSession`。

## 第三方 Agent 示例

示例：[examples/bkn-trace-business-agent.ts](examples/bkn-trace-business-agent.ts)

Dry-run 只生成不含凭据、原始 prompt、SQL 或行级数据的 2.1 fixture：

```bash
npx tsup examples/bkn-trace-business-agent.ts --format esm --out-dir .tmp-example
node .tmp-example/bkn-trace-business-agent.js --dry-run --out /tmp/bkn-trace-sdk-agent.json
node dist/cli.js trace validate-fixture /tmp/bkn-trace-sdk-agent.json
```

该文件是 contract dry-run 示例，禁止以 live 模式提交硬编码事实。生产 Agent 必须在真实检索、查询、模型、审批和 Action 发生处调用相同 API，并使用真实返回的 refs；完整本地 E2E 脚本负责验证这一生产路径。

## 查询

```bash
openbkn trace graph <trace-id>
openbkn trace evidence-chain <trace-id>
openbkn trace business-graph <trace-id>
openbkn trace snapshot-preview <trace-id>
openbkn trace evidence-chain --request-id <request-id>
```

## 敏感数据边界

- 禁止记录：token、authorization、cookie、完整配置、完整 prompt、完整 SQL、查询参数、请求/响应全文、PII。
- 只记录 hash：意图、prompt、SQL、工具参数、工具结果、结论正文。
- 只记录受控引用：业务对象、数据快照、知识网络版本、文档、工具产物、Action task/artifact。
- `business refs` 必须来自调用方已解析的结构化结果，不得从自然语言中猜测。

## 测试门槛

- `test/unit/trace-context.test.ts`：context 生成、传播和 baggage 过滤。
- `test/unit/trace-session.test.ts`：因果关联、跨 session 拒绝、Action 状态机和重试幂等。
- `test/unit/fixture-validate.test.ts`：1.0/2.0/2.1 兼容、事件注册、敏感字段负向校验。
- `test/unit/trace.test.ts`：事件提交与 Trace/Evidence/Business/Snapshot 查询 API。
- `npm run ci && npm run build` 必须通过；第三方示例 dry-run 必须通过 `trace validate-fixture`。

## 已知边界

- 普通 SDK API 调用只自动传播 Trace Context，不会自动推断 claim、evidence 或 business refs。
- 真实业务语义必须由 Agent/应用在事实发生处通过 `TraceSession` 显式记录。
- 服务端负责跨批次 `event_id` 幂等、权限过滤、图投影、快照和持久化。
