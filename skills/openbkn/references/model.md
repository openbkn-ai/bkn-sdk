# model — model factory (mf-model-manager + mf-model-api)

| Command | Notes |
|---------|-------|
| `llm\|small list [--name] [--type] [--limit n] [--page n]` | Paginated by `--page` (from 1) + `--limit` (page size, default 30). `--name`/`--type` are sent only when given (small models filter by `model_name`). There is no `--series` filter. |
| `llm\|small get <modelid>` | Detail (by model id). |
| `llm\|small add --body '<json>' \| --body-file <path>` | Register from a model definition JSON. Granular flags (`--name --series --api-model --api-base --api-key --icon` for LLMs, `--name --type --api-model --api-url --api-key --embedding-dim --max-tokens --batch-size` for small models) live on `openbkn admin llm\|small-model add` (see [admin.md](admin.md)). |
| `llm\|small edit --body …` / `delete <modelids>` (comma-joined) / `test --body …` | Update / delete / connectivity test. `edit` and `test` take the model id inside the JSON body. |
| `llm chat <model> -m "…" [--stream] [--options '<json>' \| --options-file <path>]` | OpenAI-compatible chat. `<model>` = model **name** or numeric **id** (an id is resolved to its name first). `--stream` = SSE text stream; upstream stream errors exit non-zero. Options use camelCase (`temperature`, `maxTokens`, `responseFormat`, `tools`, `toolChoice`, `timeoutMs`). |
| `small embeddings <model> -i a,b` / `rerank <model> -q <q> -d a,b` | Embedding / rerank. `<model>` = a model **name or numeric ID**; IDs resolve to names before invocation. |
| `llm set-default <id>` / `llm unset-default <id>` | Set / clear the system default LLM (admin). The `default` flag also shows on each `llm list` row. |
| `small set-default <id>` / `small unset-default <id>` | Set / clear the system default small model (type inferred from the model; admin). |
| `small get-default [--type embedding\|reranker]` | Show the current default small model for a type (`{}` = none set). |

Model list/get and small-model default reads mask adapter source and credentials as
`<redacted>`. Do not reuse those results as edit configuration; supply credentials
explicitly. The SDK shares LLM name/ID resolution with CLI and exports ChatOptions,
ChatMessage, ChatStreamOptions, ChatStreamChunk, ChatTool and ModelStreamError.
chatStream's optional onChunk callback exposes tool-call deltas and usage; tools
are never auto-executed. Use signal/timeoutMs to bound calls. Already emitted text
is partial if the stream rejects, including EOF before DONE.
