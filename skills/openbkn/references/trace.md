# trace — BKN Trace

| Command | Notes |
|---------|-------|
| `get <conversation-id> [--max-spans]` | Fetch all spans for a conversation (two-hop OpenSearch). |
| `search --body <json>` | Raw trace _search. |
| `diagnose <conversation-id> [--llm]` | Symbolic rules always run (5 builtin predicates: tool loop / swallowed tool error / empty-retrieval-no-fallback / truncated-no-continue / excessive tool calls). `--llm` adds gated rubric judgments + a synthesized summary via the local `claude` CLI (hybrid mode). |
| `scan <conv,conv,…> [--llm]` | Batch-diagnose + a recurring-rule tally. |
| `eval-set build <queries.json> [--out f]` | Lift eval cases from a queries file. |
| `schema validate <file> [--kind eval-set|rule]` | Validate an eval-set / diagnosis-rule file (JSON or YAML). |

`--llm` paths use the local `claude` binary; without it they degrade to symbolic-only / skip `semantic_match`. The trace index must be populated for `get`/`diagnose` to return data.
