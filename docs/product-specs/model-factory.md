# Model factory

## Goal

Manage and invoke models: large models (LLM) and small models (embedding/rerank/etc.), plus OpenAI-compatible chat. Spans user invocation and operator management.

## User-visible behavior

- `openbkn model llm|small list [--name] [--type] [--limit] [--page]` and `openbkn admin llm|small-model list [--name] [--type] [--page] [--size]` — registered models (limit 30), paged by `page` + `size`. Filters are sent only when given (no empty `name=`/`model_type=`); the LLM list filters by `name`, the small-model list by `model_name`.
- `openbkn model get <id>` / `add` / `edit` / `delete` — model registry CRUD (operator).
- `openbkn model test <id>` — connectivity / smoke test.
- `openbkn model llm chat <model>` — OpenAI-compatible chat against a managed LLM. A numeric `<model>` is resolved to its `model_name` through `llm/get`, accepting both a bare record and a `{data: {...}}` envelope.

## SDK touchpoints

- `resources/models.ts` over `api/models.ts` (management, `mf-model-manager`) and `api/model-invocation.ts` (chat / small-model calls, `mf-model-api`).
- Operator CRUD requires an operator token; invocation accepts a user token.

## Edge cases

- Distinguish management endpoints (admin) from invocation endpoints (user) by token; a user token on a management call → clear 403.
- `test`/`chat` honor timeouts; do not auto-retry generation. The transport resends only a request whose connection was never established ([RELIABILITY](../RELIABILITY.md#retries)).
- Never log API keys configured on a model.
