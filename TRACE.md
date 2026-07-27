# bkn-sdk / openbkn CLI Trace Contract

> Status: phase-two helper baseline  
> Contract version: `bkn.trace.schema.version=1.0.0` for phase-one fixture validation; `2.0.0` for evidence event emission  
> Reference: `bkn-docs/docs/foundry/bkn-trace/design/阶段一：OpenBKN 可观测记录规范与 Trace Context 基线.md`, `bkn-docs/docs/foundry/bkn-trace/design/阶段二：证据引用采集与 BKN Trace 核心能力开发计划.md`

## Module

- module name: `sdk-cli`
- owner: OpenBKN SDK
- service identity: SDK / CLI caller
- runtime: TypeScript / Node.js
- repository path: `bkn-sdk`
- contract version: `1.0.0` for trace context / fixture validation, `2.0.0` for evidence ingestion

## Entry Operations

| operation | trigger | required context | emitted spans | emitted events |
| --- | --- | --- | --- | --- |
| `sdk.request` | SDK consumer calls an OpenBKN API | optional caller trace context | none in phase one | none in phase one |
| `sdk.openbkn.call` | SDK HTTP request to OpenBKN | `traceparent`, `bkn-request-id` | none in phase one | none in phase one |
| `cli.command` | `openbkn` command invocation | optional caller trace context | none in phase one | none in phase one |
| `cli.trace.validate_fixture` | fixture validation command or equivalent | local request context | none in phase one | validation result output |
| `cli.trace.evidence.emit` | `openbkn trace evidence emit <file>` | evidence batch trace context | none | server-side `claim.created` / `evidence.refs.created` / `business.refs.resolved` ingestion |

## Inbound Context

- accepted options: `ClientOptions.trace.requestId`, `ClientOptions.trace.traceparent`, `ClientOptions.trace.conversationId`, `ClientOptions.trace.interactionId`, `ClientOptions.trace.baggage`
- request id parsing: valid `req_<id>` is preserved; invalid or missing values generate `req_<uuid>`
- traceparent parsing: valid W3C version `00` is preserved; invalid, all-zero trace id, or all-zero span id generate a new internal traceparent
- conversation / interaction ids: caller-owned. Format `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`, issuer prefixes such as `agent:thread_x` allowed. Blank or malformed values are dropped without failing the request, and **nothing is generated in their place** — only the caller knows where a conversation or one round of analysis begins and ends, so a client-minted id would collapse unrelated rounds into one false grouping. Resolution order: explicit option, then `BKN_CONVERSATION_ID` / `BKN_INTERACTION_ID`, then absent.
- CLI: `--conversation-id` / `--interaction-id` global flags map to the same options; the env vars exist because the CLI runs one process per call, so a shell session or skill script can mark several calls as one interaction.
- baggage policy: allowlist-only; only `bkn.account.type` and `bkn.runtime.env` propagate. Correlation ids never enter baggage.

## Outbound Calls

| target | protocol | propagated fields | baggage policy | timeout | retry |
| --- | --- | --- | --- | --- | --- |
| OpenBKN APIs | HTTP | `traceparent`, `bkn-request-id`, `x-request-id`; `bkn-conversation-id` / `bkn-interaction-id` only when the caller supplied them | allowlist-only baggage | existing request timeout | existing refresh/retry policy |
| BKN Trace evidence ingestion | HTTP | `traceparent`, `bkn-request-id`, `x-request-id`; evidence batch carries its own `trace` and `events` | allowlist-only baggage | existing request timeout | existing refresh/retry policy |
| Raw call passthrough | HTTP | generated context plus explicit caller headers | allowlist-only generated baggage; caller extra headers can override deliberately | `RawCallOptions.timeoutMs` | existing refresh/retry policy |

## Logs

SDK/CLI phase one does not add persistent logs by default. If commands emit diagnostic output, they must not include token, authorization, cookie, full prompt, full SQL, full request body, full response body, or PII.

## Spans

SDK/CLI does not start OpenTelemetry spans in phase one. It injects trace context into outbound HTTP requests so server-side spans, logs, and events can join by `trace_id` and `bkn.request.id`.

## Events

SDK/CLI now exposes a phase-two submit helper for event batches:

- SDK: `client.trace.emitEvidenceEvents(body)`
- CLI: `openbkn trace evidence emit <file>`

The SDK does not synthesize evidence events automatically. Callers must provide a `2.0.0` batch containing `trace` and `events`, and the server validates `claim.created`, `evidence.refs.created`, and `business.refs.resolved`.

## Sensitive Data Rules

- never log: token, authorization, cookie, full local config, full request body, full response body, prompt, SQL, PII
- hash only: future prompt, SQL, tool args, tool result
- controlled reference: future large object and evidence refs
- baggage allowlist: `bkn.account.type`, `bkn.runtime.env`

## Sampling

- default: generated traceparent uses sampled flag `01`
- forced sampling: command failures and validation failures should be treated as forced-sampled by downstream trace collectors when available
- not sampled behavior: request id still propagates

## Fixtures And Tests

| fixture or test | path | purpose | expected result |
| --- | --- | --- | --- |
| unit | `test/unit/trace-context.test.ts` | generated request id, valid traceparent propagation, baggage filtering | pass |
| unit | `test/unit/trace.test.ts` | phase-two evidence emit endpoint path, method, body, response | pass |
| unit | `test/unit/headers.test.ts` | auth header safety plus generated trace headers | pass |
| contract fixture | `fixtures/bkn-trace/positive.json` | request id injection shape | pass |
| contract fixture | `fixtures/bkn-trace/propagation.json` | outbound context propagation shape | pass |
| contract fixture | `fixtures/bkn-trace/sampling.json` | validation failure forced-sampled shape | pass |
| contract fixture | `fixtures/bkn-trace/negative_baggage.json` | forbidden baggage key rejection | fail |

## Known Gaps

- SDK/CLI exposes `openbkn trace validate-fixture`; bkn-docs remains the source of the shared fixture contract and Python reference validator.
- SDK/CLI can submit phase-two evidence event batches, but does not yet generate claim/evidence/business events automatically from ordinary SDK calls.
- Raw call explicit headers can intentionally override generated trace context; this is preserved for operator debugging.
