# Model factory

## Goal

Manage and invoke models: large models (LLM) and small models (embedding/rerank/etc.), plus OpenAI-compatible chat. Spans user invocation and operator management.

## User-visible behavior

- `openbkn model list` — registered models (limit 30); filter by kind (llm | small-model).
- `openbkn model get <id>` / `add` / `edit` / `delete` — model registry CRUD (operator).
- `openbkn model test <id>` — connectivity / smoke test.
- `openbkn model chat <id>` — OpenAI-compatible chat against a managed LLM.

## SDK touchpoints

- `resources/models.ts` over `api/models.ts` (management, `mf-model-manager`) and `api/model-invocation.ts` (chat / small-model calls, `mf-model-api`).
- Operator CRUD requires an operator token; invocation accepts a user token.

## Edge cases

- Distinguish management endpoints (admin) from invocation endpoints (user) by token; a user token on a management call → clear 403.
- `test`/`chat` honor timeouts; do not auto-retry generation.
- Never log API keys configured on a model.
