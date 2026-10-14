# Model factory

## Goal

Manage and invoke models: large models (LLM) and small models (embedding/rerank/etc.), plus OpenAI-compatible chat. Spans user invocation and operator management.

## User-visible behavior

- `openbkn model llm|small list [--name] [--type] [--limit] [--page]` and `openbkn admin llm|small-model list [--name] [--type] [--page] [--size]` — registered models (limit 30), paged by `page` + `size`. Filters are sent only when given (no empty `name=`/`model_type=`); the LLM list filters by `name`, the small-model list by `model_name`.
- `openbkn model get <id>` / `add` / `edit` / `delete` — model registry CRUD (operator).
- `openbkn model test <id>` — connectivity / smoke test.
- `openbkn model llm chat <model>` — OpenAI-compatible chat against a managed LLM. A numeric `<model>` is resolved to its `model_name` through `llm/get`, accepting both a bare record and a `{data: {...}}` envelope.

## SDK touchpoints

- `resources/models.ts` over `api/models.ts` (management, `mf-model-manager`) and `api/model-chat.ts` (chat options/SSE handling), `api/model-response.ts` (management-read protection). Invocation routes in `api/models.ts` target `mf-model-api`.
- Operator CRUD requires an operator token; invocation accepts a user token.

## Edge cases

- Distinguish management endpoints (admin) from invocation endpoints (user) by token; a user token on a management call → clear 403.
- `test`/`chat` honor timeouts; do not auto-retry generation. The transport resends only a request whose connection was never established ([RELIABILITY](../RELIABILITY.md#retries)).
- Never log API keys configured on a model.

## Model SDK contract

- LLM chat and chatStream resolve numeric IDs in the API layer, shared by CLI and SDK. Bare and data-enveloped detail results are supported; names avoid metadata calls and lookup errors retain their original status.
- Additive ChatOptions map camelCase to wire fields: temperature, topP/topK, maxTokens/maxCompletionTokens, penalties, responseFormat, tools/toolChoice, stop, cache, and system. Messages accept structured or null content and OpenAI tool-call fields; provider extension fields such as name, refusal and reasoning_content are preserved. Roles remain the backend-supported user/assistant/system/tool. Invalid options are rejected before requests.
- ChatStreamOptions.onChunk exposes full tool/usage chunks without changing the text return value. SDK does not execute tools. Empty/whitespace data keep-alives are ignored (explicit error events still fail). SSE error frames, malformed JSON, missing DONE, callback errors, cancellation, and inference timeout reject rather than silently returning partial text. Readers are canceled/released on completion or failure.
- Inference requests default to 30 seconds; timeoutMs controls response consumption too, and signal cancels the request. Registry/version preflight requests retain their own deadlines.
- CLI chat accepts --options / --options-file with the same camelCase controls. API field names such as max_tokens are not CLI option keys.
- Management list/get and small-model default reads preserve bigint IDs and redact adapter_code plus credential-shaped fields before returning results. Both model and admin CLI reads inherit the same behavior. Metadata is not a reusable edit payload; raw call is intentionally unfiltered. Existing exposed credential rotation belongs to the platform/model owner (#118), not this SDK change.
