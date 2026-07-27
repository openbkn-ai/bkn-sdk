# BKN Trace：SDK 与第三方 Agent

## 目标

让任意第三方 Agent 或 AI 应用在调用 OpenBKN 时，不仅留下技术调用链，还能留下可解释、可溯源、可复查的业务链：用户意图、业务操作、结论、证据引用、本体业务对象和 Action 结果。

## 用户可见能力

- 从可筛选、可分页的业务运行列表进入，不要求业务用户理解或手工输入内部 ID。
- 按用户问题、业务结果、时间、Agent/应用、业务域、知识网络、状态和证据完整度筛选。
- 从一条 `request id` 下钻其一个或多个 `trace id`，再查看 Span 技术调用链。
- 从结论回到产生结论的知识读取、数据查询、模型/工具操作。
- 从证据回到有版本的知识网络、数据快照和受控产物引用。
- 从业务引用看到对象、属性、关系、指标、逻辑和行动，而不是只有 span 数量。
- 查看 Action 推荐、审批、执行与结果；未批准和已拒绝的 Action 不得显示为已执行。

## SDK 接口

- `client.trace.createSession(...)`：创建 BKN Trace 2.1 兼容或 2.2 业务内容制品会话。
- `TraceSession.startInteraction/observeOperation/createClaim`：建立业务因果链。
- `TraceSession.createEvidenceRefs/resolveBusinessRefs`：建立证据与本体业务语义链。
- `TraceSession.recommendAction/.../recordActionResult`：记录受约束的 Action 生命周期。
- `TraceSession.flush()`：批量提交并支持失败重试。
- `client.trace.emitArtifact/artifact`：写入和读取受权的用户问题、结果、查询、数据、逻辑和行动制品。
- `client.trace.requests.list/get/traces`：查询业务运行列表、详情及其关联技术 Trace。
- `client.trace.emitEvidenceEvents(...)`：兼容底层 2.0/2.1/2.2 批次提交。
- `client.trace.graph/evidenceChain/businessGraph/snapshotPreview`：查询展示所需数据。

## 业务引用合同

SDK 在创建 `business.refs.resolved` 或 Action target 时校验全限定引用：

```text
kn:<kn_id>
object:<kn_id>:<object_type_id>
property:<kn_id>:<object_type_id>:<property_id>
relation:<kn_id>:<relation_type_id>
action_type:<kn_id>:<action_type_id>
metric:<kn_id>:<metric_id>
resource:<resource_id>
field:<resource_id>:<field_id>
```

`object` 表示对象类型，不表示对象实例。实例级信息只能使用平台认可的受控 source/evidence 或 opaque artifact ref，不能在通用事件里裸传业务主键。短引用在 SDK 侧直接拒绝，避免把不可唯一定位的事件提交到核心。

## CLI 接口

- `openbkn trace graph <trace-id>`
- `openbkn trace evidence-chain [trace-id] [--request-id <id>]`
- `openbkn trace business-graph [trace-id] [--request-id <id>]`
- `openbkn trace snapshot-preview [trace-id] [--request-id <id>]`
- `openbkn trace validate-fixture <path>`
- `openbkn trace evidence emit <file>`

## 完成标准

第三方 Agent 示例必须先持久化受权 Artifact，再由 2.2 事件引用这些制品，形成完整五层业务链并通过 contract validate。普通日志、Span 和核心事件不得包含凭据或未受控原文；真实 E2E 还必须由服务端业务运行查询结果和 Studio 正式菜单页面共同验收。
