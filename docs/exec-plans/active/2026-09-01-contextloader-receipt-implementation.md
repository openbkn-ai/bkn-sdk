# ContextLoader Receipt 与身份隔离实施计划

> **For Codex:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** 让 ContextLoader 的 Receipt 输出与自动生命周期共用同一调用链，并隔离跨身份的 MCP / catalog 缓存，同时保持现有 SDK 与默认 CLI 输出兼容。

**Architecture:** 在 `context-loader.ts` 建立包内结果通路，先应用现有 lifecycle 决策再解析受验证的 Receipt。`toolCall()` 继续返回 value，既有 `managedToolCall()` 要求 Receipt，CLI 只在 `--receipt --json` 时使用后者。身份、业务 context 与 Receipt 的完整性在 I/O 边界验证；真实 E2E 验证服务端授权与 exactly-once，而非由客户端猜测。

**Tech Stack:** TypeScript ESM、Vitest、Commander、native `fetch` / MCP JSON-RPC、BKN Trace lifecycle API、shell E2E。

**Design / Issues:** Design PR #87; `Closes #68, Closes #88` only in the implementation PR after every acceptance criterion below passes.

## Execution status (2026-09-01)

| Task | Status | Evidence |
| --- | --- | --- |
| 1. Regression coverage | Complete | `5fe809d`, plus state/context/privacy cases in `604f093` |
| 2. Lifecycle-safe result path | Complete | `ce368e8`, `604f093` |
| 3. One context and identity-isolated caches | Complete | `4e8297a`, `d9bf4f4`, `cedb2c7`, `604f093` |
| 4. CLI and safe diagnostics | Complete | `a9d19db`, `2467a5b`, `116b751`, `604f093` |
| 5. User contract and observations | Complete | `b3358ad` |
| 6. Deployed evidence | Partial | `b2bc119` adds write-gated validated-envelope + same-identity readback. Two-identity authorization, response-drop fault injection, and server-side execution count require an approved target and remain release/Issue-close gates. |

---

### Task 1: Establish lifecycle and Receipt regression coverage

**Files:**
- Modify: `test/unit/context-loader.test.ts`
- Modify: `test/unit/lifecycle.test.ts`
- Modify: `test/unit/conversation-reuse.test.ts`

**Step 1: Write failing tests for the current public-path gaps**

Add mocked MCP tests that prove:

- `managedToolCall()` without caller `bkn_context` probes lifecycle, injects `bkn_context`, and returns the same validated Receipt as the business tool call;
- caller-owned `bkn_context` is sent unchanged and a matching Receipt succeeds;
- normal `structuredContent.bkn_receipt`, replay `structuredContent.receipt` with a value, replay without value, pending, failed, missing, and malformed Receipts have the design-specified behavior;
- `toolCall()` keeps returning exactly the prior business value;
- same base URL / KN with two tokens uses different MCP session ids and catalog probes.

**Step 2: Run the focused tests and confirm the new tests fail**

Run: `npx vitest run test/unit/context-loader.test.ts test/unit/lifecycle.test.ts test/unit/conversation-reuse.test.ts`

Expected: new `managedToolCall` automatic-context, alternate Receipt, and identity-isolation tests fail against `origin/main` behavior.

**Step 3: Commit only the red tests**

Run: `git add test/unit/context-loader.test.ts test/unit/lifecycle.test.ts test/unit/conversation-reuse.test.ts && git commit -m "test(context): expose receipt lifecycle gaps"`

### Task 2: Build the internal lifecycle-safe result path

**Files:**
- Modify: `src/api/context-loader.ts`
- Modify: `src/resources/context-loader.ts`
- Modify: `src/index.ts` only if existing type exports need correction; do not export a new result API
- Test: `test/unit/context-loader.test.ts`

**Step 1: Keep the transport and business sessions distinct**

Rename the MCP transport helper/cache names to make clear that they manage only `MCP-Session-Id`; do not change lifecycle business-session ownership in `src/api/lifecycle.ts` as part of this refactor.

**Step 2: Implement a private raw result function**

Make the raw MCP path return parsed `{ value, receipt?, disposition }` rather than discarding `receipt`. Keep lifecycle tools raw so lifecycle setup cannot recurse.

**Step 3: Implement runtime Receipt validation**

Accept only non-empty `receipt_id`, `conversation_id`, `interaction_id`, `operation_id` and `receipt_status` in `pending | completed | failed`. Reject unknown or malformed objects. When a request carried a business context, require its Conversation / Interaction to equal the Receipt.

**Step 4: Implement `callToolResult()`**

For caller-owned context, send unchanged. For non-lifecycle tools without it, call `withManagedLifecycle()`. Preserve its bounded SDK-owned stale recovery. Map result states exactly:

- completed / replay with content value → value + validated receipt;
- replay without a value and pending → `value: null` + validated receipt, with no second business call;
- failed → typed failure, never a fabricated value.

**Step 5: Preserve public surfaces**

`callTool()` unwraps `.value`; `callManagedTool()` uses `callToolResult()` and fails on absent or invalid Receipt. Do not add a new resource method or index export.

**Step 6: Run focused tests and commit**

Run: `npx vitest run test/unit/context-loader.test.ts test/unit/lifecycle.test.ts`

Expected: all Task 1 tests pass.

Run: `git add src/api/context-loader.ts src/resources/context-loader.ts src/index.ts test/unit/context-loader.test.ts test/unit/lifecycle.test.ts && git commit -m "fix(context): retain lifecycle-safe receipts"`

### Task 3: Enforce one business context and isolate caches

**Files:**
- Modify: `src/api/context-loader.ts`
- Modify: `src/api/lifecycle.ts`
- Modify: `src/commands/_shared.ts`
- Modify: `test/unit/context-loader.test.ts`
- Modify: `test/unit/lifecycle.test.ts`
- Modify: `test/unit/conversation-reuse.test.ts`

**Step 1: Write failing tests for invalid or conflicting context**

Cover interaction-only CLI / env / SDK trace inputs, caller `bkn_context` conflicting with trace IDs, matching IDs, token refresh / identity partition, and absence of duplicate business headers.

**Step 2: Run the targeted tests and confirm red state**

Run: `npx vitest run test/unit/context-loader.test.ts test/unit/lifecycle.test.ts test/unit/conversation-reuse.test.ts`

Expected: interaction-only is currently accepted and transport / contract cache identity tests fail.

**Step 3: Implement preflight and header policy**

Reject an Interaction without its paired Conversation before any MCP request. When caller-owned `bkn_context` is present, reject partial or mismatching business Trace IDs; when no Trace business IDs exist, retain technical headers but omit business Conversation / Interaction headers.

**Step 4: Partition caches without retaining tokens**

Use a versioned, namespaced one-way token hash in the MCP transport-session and lifecycle catalog / probe cache keys. Recompute it after credential refresh. Do not put the hash in logs, CLI output, or metric labels.

**Step 5: Run focused tests and commit**

Run: `npx vitest run test/unit/context-loader.test.ts test/unit/lifecycle.test.ts test/unit/conversation-reuse.test.ts`

Run: `git add src/api/context-loader.ts src/api/lifecycle.ts src/commands/_shared.ts test/unit/context-loader.test.ts test/unit/lifecycle.test.ts test/unit/conversation-reuse.test.ts && git commit -m "fix(context): isolate identity-bound lifecycle state"`

### Task 4: Add the opt-in CLI contract and safe diagnostics

**Files:**
- Modify: `src/commands/context.ts`
- Modify: `src/utils/errors.ts` or a context-specific error-rendering helper
- Modify: `test/unit/context-loader.test.ts`
- Create or modify: `test/unit/context-command.test.ts`
- Modify: `test/unit/help-contract.test.ts`

**Step 1: Write failing command tests**

Assert the exact `{ value, bkn_receipt }` envelope for `--receipt --json`, one-line equivalent for `--compact`, and preflight `InputError` / zero MCP request for `--receipt` without `--json` or combined with `--schema`. Assert default output is unchanged. Add known lifecycle errors containing query-like raw text and assert no raw query reaches stderr.

**Step 2: Run the command tests and confirm red state**

Run: `npx vitest run test/unit/context-command.test.ts test/unit/help-contract.test.ts`

Expected: `--receipt` is unknown and diagnostics do not yet have fixed hints.

**Step 3: Implement the flag via the existing resource method**

Add `--receipt`; route it only to the repaired `client.context.managedToolCall()`. Do not let commands import API internals or access `client.ctx`. Enforce the design truth table before the request.

**Step 4: Implement allowlisted diagnostics**

For known lifecycle codes provide fixed non-sensitive instructions; preserve codes and exit categories. Unknown errors retain existing compatibility behavior. No message, JSON output, log, or metric label may include token, query, raw arguments, rows, or full business IDs.

**Step 5: Run tests and commit**

Run: `npx vitest run test/unit/context-command.test.ts test/unit/help-contract.test.ts test/unit/context-loader.test.ts`

Run: `git add src/commands/context.ts src/utils/errors.ts test/unit/context-command.test.ts test/unit/help-contract.test.ts test/unit/context-loader.test.ts && git commit -m "feat(context): expose validated receipt output"`

### Task 5: Update user contracts and controlled observability

**Files:**
- Modify: `docs/design-docs/cli-command-design.md`
- Modify: `README.md`
- Modify: `README.zh.md`
- Modify: `skills/openbkn/references/context.md`
- Modify: `docs/product-specs/bkn-trace.md`
- Modify: `docs/QUALITY_SCORE.md` if a new test / E2E signal is added
- Test: `test/unit/help-contract.test.ts`

**Step 1: Update only the approved public guidance**

Document the `--receipt --json` requirement, one-turn Interaction lifetime, Conversation precedence, `validated` versus `authorized` Receipt evidence, and the fact that Receipt JSON is not a bearer credential.

**Step 2: Define observation ownership without a new public telemetry API**

Document the fixed-enum counts required from the test harness / server Trace and their privacy allowlist. Do not add a network telemetry emitter or SDK metrics API.

**Step 3: Run help / docs checks and commit**

Run: `npx vitest run test/unit/help-contract.test.ts test/unit/openbkn-skill-contract.test.ts`

Run: `git add docs/design-docs/cli-command-design.md README.md README.zh.md skills/openbkn/references/context.md docs/product-specs/bkn-trace.md docs/QUALITY_SCORE.md test/unit/help-contract.test.ts && git commit -m "docs(context): document receipt lifecycle contract"`

### Task 6: Prove deployed behavior and release safety

**Files:**
- Modify: `test/e2e/live-write.sh` or add a focused ContextLoader receipt E2E script
- Modify: `test/e2e/live-suite.sh` only for read-only coverage
- Modify: `docs/QUALITY_SCORE.md`

**Step 1: Add E2E fixtures and prerequisites**

Require explicit write gate, two authorized identities, a target deployment with lifecycle catalog visibility, and a server-side fault-injection / execution-count observation point. Fail closed with a clear skip reason when unavailable; do not fake the evidence with a mock.

**Step 2: Implement and run the E2E matrix**

Verify two new-process turns in one Conversation, terminal Interaction rejection, current-identity receipt readback, cross-identity denial, no transport session reuse, and response-after-execution disconnect / pending handling with one server-side execution.

**Step 3: Record evidence and perform full verification**

Run: `npm run lint && npm test && npm run build`

Run: `BKN_E2E_WRITE=1 BKN_BASE_URL=<approved-target> BKN_TOKEN=<identity-a> ... npm run test:e2e:write`

Expected: lint, unit tests, build, and every approved live assertion pass; evidence redacts tokens, raw query values, rows, and complete business IDs.

**Step 4: Commit and prepare PR**

Run: `git add test/e2e docs/QUALITY_SCORE.md && git commit -m "test(context): verify receipt lifecycle evidence"`

Open the implementation PR with the completed template, review its diff, use `Closes #68, Closes #88` only when every AC is satisfied, and request human review. Do not merge.
