# Tech debt tracker

Running list. Pay down in small PRs. Add a row when you knowingly defer something.

| Item | Area | Notes | Priority |
| ---- | ---- | ----- | -------- |
| Trace diagnose engine | trace | `trace get`/`search` are real; `diagnose`/`eval-set`/`schema` (rule engine + LLM-as-judge via local `claude`, rubric/artifact persistence) are a large standalone feature, still stubbed. Implement as its own multi-phase slice (ref kweaver-sdk src/trace-ai). | High |
| bkn local-file ops | bkn | `push`/`pull`/`validate` (BKN dir ↔ tar, encoding detect, COPYFILE_DISABLE) and `create-from-catalog`/`create-from-csv` (multi-step orchestration) still stubbed. | High |
| Admin CRUD detail | admin | org/user CRUD (create/update/delete/get/tree/members, reset-password) still stubbed; the 37 failing equivalence cases are admin depth-2 flag coverage. Add real flags + ISFWeb/UM contracts (needs an operator env to verify). | Medium |
| Real-backend regression | api | Read paths re-validated live (13/13 green via `test/e2e/live-smoke.sh`; `bkn search` matches legacy byte-for-byte). Admin operator endpoints reachable but permission-gated (test user isn't an operator) — re-run admin with an operator token. Note: `kweaver token` refresh on a self-signed platform needs `NODE_TLS_REJECT_UNAUTHORIZED=0`. | Medium |
| explore command | cli | Legacy `explore` launches a local web UI; confirm it fits backend-only scope or drop. Currently a stub. | Low |
| Output formatting | utils | Commands print raw backend JSON; add human table formatting for non-`--json` output (legacy formats some lists). | Low |
| Streaming chat | agent/model | `agent chat` + `model llm chat --stream` are non-streaming / stubbed; add SSE streaming. | Medium |
| tool/skill uploads | commands | `tool upload`, `skill register`/`download`/`install` need multipart/zip handling. | Low |
| relation-type-paths | bkn | `bkn relation-type-paths` stubbed (path query between object types) — confirm endpoint. | Low |

When an item is fixed, delete its row (git history keeps the record).
