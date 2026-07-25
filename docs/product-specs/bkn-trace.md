# BKN Trace：SDK 与第三方 Agent

## 目标

让任意第三方 Agent 或 AI 应用在调用 OpenBKN 时，不仅留下技术调用链，还能留下可解释、可溯源、可复查的业务链：用户意图、业务操作、结论、证据引用、本体业务对象和 Action 结果。

## 用户可见能力

- 按 `trace id` 或 `request id` 查询技术调用链、证据链和业务语义图。
- 从结论回到产生结论的知识读取、数据查询、模型/工具操作。
- 从证据回到有版本的知识网络、数据快照和受控产物引用。
- 从业务引用看到对象、属性、关系、指标、逻辑和行动，而不是只有 span 数量。
- 查看 Action 推荐、审批、执行与结果；未批准和已拒绝的 Action 不得显示为已执行。

## SDK 接口

- `client.trace.createSession(...)`：创建 BKN Trace 2.1 强类型业务会话。
- `TraceSession.startInteraction/observeOperation/createClaim`：建立业务因果链。
- `TraceSession.createEvidenceRefs/resolveBusinessRefs`：建立证据与本体业务语义链。
- `TraceSession.recommendAction/.../recordActionResult`：记录受约束的 Action 生命周期。
- `TraceSession.flush()`：批量提交并支持失败重试。
- `client.trace.emitEvidenceEvents(...)`：兼容底层 2.0/2.1 批次提交。
- `client.trace.graph/evidenceChain/businessGraph/snapshotPreview`：查询展示所需数据。

## CLI 接口

- `openbkn trace graph <trace-id>`
- `openbkn trace evidence-chain [trace-id] [--request-id <id>]`
- `openbkn trace business-graph [trace-id] [--request-id <id>]`
- `openbkn trace snapshot-preview [trace-id] [--request-id <id>]`
- `openbkn trace validate-fixture <path>`
- `openbkn trace evidence emit <file>`

## 完成标准

第三方 Agent 示例必须产生完整五层业务链，通过 2.1 contract validate，不包含原始 prompt、SQL、行级数据或凭据；真实 E2E 还必须由服务端查询结果和 Studio 正式菜单页面共同验收。
