# trace — BKN Trace

Everything reads and writes the agent-observability REST contract (`/api/agent-observability/v1`).

| Command | Notes |
|---------|-------|
| `search [--service s] [--tool t] [--agent-or-app name] [--keyword text] [--error-keyword text] [--status s] [--from t] [--to t] [--trace-id id] [--conversation-id id] [--interaction-id id] [--limit 1..200] [--cursor c]` | Typed technical trace list → `{entries, total, next_cursor, partial}`. `--keyword` matches trace/request/operation/error text; `--error-keyword` matches error text only (not an alias). `--service`/`--tool`/`--error-keyword` work live but are not yet in the foundry spec. |
| `get <conversation-id> [--max-spans n]` (= `spans`) | A conversation's normalized spans: lists its traces (`GET /traces?conversation_id=`, following `next_cursor`, up to 100 traces), then reads each trace's detail. |
| `spans <conversation-id> [--max-spans n]` | Same as `get`. |
| `detail <trace-id>` | One typed technical trace: summary, span graph and operation facts (input / output / error). Human text by default, JSON with `--json`. Missing summary or operation fields render as `-`. |
| `graph <trace-id>` | The span graph of one trace → `{trace_id, status, data: {nodes, edges}}`. |
| `diagnose <conversation-id> [--llm]` | Symbolic rules always run (5 builtin predicates: tool loop / swallowed tool error / empty-retrieval-no-fallback / truncated-no-continue / excessive tool calls). Rules the trace facts can't support are listed in `skippedRules`. `--llm` adds gated rubric judgments + a synthesized summary via the local `claude` CLI (hybrid mode). |
| `scan <conv,conv,…> [--llm]` | Batch-diagnose + a recurring-rule tally. |
| `conversations list [--limit]` / `get <id>` / `ensure-current <external-key>` / `create-new-generation <external-key> --idempotency-key k` / `resume <id>` / `close <id>` | Managed Conversation records. |
| `interactions start <conversation-id>` / `get <id>` / `operations <id>` / `complete\|fail\|cancel\|handoff <id>` | Managed Interaction lifecycle. Terminal manifests go in `--body-file`. |
| `operations get <id>` / `attempt <id> <attempt>` / `retry <id>` | Operation facts and attempts; retry fencing (lease token/epoch) goes in `--body-file`, never on the command line. |
| `receipts get <receipt-id>` | Read a durable operation receipt back under the current identity (what makes a `--receipt` from `context tool-call` authorized, not just validated). |
| `eval-set build <queries.json> [--out f]` | Lift eval cases from a queries file. |
| `schema validate <file> [--kind eval-set\|rule]` | Validate an eval-set / diagnosis-rule file (JSON or YAML). |
| `validate-fixture <path>` | Validate BKN Trace fixture JSON files (a file or a directory); exit 1 when any is invalid. |

`--llm` paths use the local `claude` binary; without it they degrade to symbolic-only / skip `semantic_match`. `get`/`diagnose` return nothing for a conversation whose calls were never recorded as traces.
