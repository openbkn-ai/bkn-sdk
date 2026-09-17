# model — model factory (mf-model-manager + mf-model-api)

| Command | Notes |
|---------|-------|
| `llm\|small list [--name] [--type] [--limit n] [--page n]` | Paginated by `--page` (from 1) + `--limit` (page size, default 30). `--name`/`--type` are sent only when given (small models filter by `model_name`). There is no `--series` filter. |
| `llm\|small get <modelid>` | Detail (by model id). |
| `llm\|small add --body '<json>' \| --body-file <path>` | Register from a model definition JSON. Granular flags (`--name --series --api-model --api-base --api-key --icon` for LLMs, `--name --type --api-model --api-url --api-key --embedding-dim --max-tokens --batch-size` for small models) live on `openbkn admin llm\|small-model add` (see [admin.md](admin.md)). |
| `llm\|small edit --body …` / `delete <modelids>` (comma-joined) / `test --body …` | Update / delete / connectivity test. `edit` and `test` take the model id inside the JSON body. |
| `llm chat <model> -m "…" [--stream]` | OpenAI-compatible chat. `<model>` = model **name** or numeric **id** (an id is resolved to its name first). `--stream` = SSE token stream. |
| `small embeddings <model> -i a,b` / `rerank <model> -q <q> -d a,b` | Embedding / rerank. `<model>` = the model **name** (`model_name`), NOT the numeric id — a numeric id currently 400s (`ModelFactory.ExternalSmallModel.*`). Unlike `llm chat`, these do not yet resolve id→name. Find the name via `small list`. Tracked for a fix. |
| `llm set-default <id>` / `llm unset-default <id>` | Set / clear the system default LLM (admin). The `default` flag also shows on each `llm list` row. |
| `small set-default <id>` / `small unset-default <id>` | Set / clear the system default small model (type inferred from the model; admin). |
| `small get-default [--type embedding\|reranker]` | Show the current default small model for a type (`{}` = none set). |
