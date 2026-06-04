# model — model factory (mf-model-manager + mf-model-api)

| Command | Notes |
|---------|-------|
| `llm|small list [--name] [--page] [--size] [--series|--type]` | Paginated (page + size, NOT limit). |
| `llm|small get <modelid>` | Detail (by model id). |
| `llm add --name --series --api-model --api-base --api-key --icon` | LLM register (or `--body`). |
| `small add --name --type --api-model --api-url --api-key --embedding-dim --max-tokens --batch-size` | Small-model register. |
| `llm|small edit <modelid> …` / `delete <modelid…>` / `test <modelid>` | Update / delete / connectivity test. |
| `llm chat <name> -m "…" [--stream]` | OpenAI-compatible chat. **The chat arg is the model NAME, not the numeric id.** `--stream` = SSE token stream. |
| `small embeddings <id> -i a,b` / `rerank <id> -q <q> -d a,b` | Embedding / rerank. |
