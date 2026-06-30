# model — model factory (mf-model-manager + mf-model-api)

| Command | Notes |
|---------|-------|
| `llm|small list [--name] [--page] [--size] [--series|--type]` | Paginated (page + size, NOT limit). |
| `llm|small get <modelid>` | Detail (by model id). |
| `llm add --name --series --api-model --api-base --api-key --icon` | LLM register (or `--body`). |
| `small add --name --type --api-model --api-url --api-key --embedding-dim --max-tokens --batch-size` | Small-model register. |
| `llm|small edit <modelid> …` / `delete <modelid…>` / `test <modelid>` | Update / delete / connectivity test. |
| `llm chat <model> -m "…" [--stream]` | OpenAI-compatible chat. `<model>` = model **name** or numeric **id** (an id is resolved to its name first). `--stream` = SSE token stream. |
| `small embeddings <id> -i a,b` / `rerank <id> -q <q> -d a,b` | Embedding / rerank. |
| `llm set-default <id>` / `llm unset-default <id>` | Set / clear the system default LLM (admin). The `default` flag also shows on each `llm list` row. |
| `small set-default <id>` / `small unset-default <id>` | Set / clear the system default small model (type inferred from the model; admin). |
| `small get-default [--type embedding\|reranker]` | Show the current default small model for a type (`{}` = none set). |
