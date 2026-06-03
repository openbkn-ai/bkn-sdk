# Tech debt tracker

Running list. Pay down in small PRs. Add a row when you knowingly defer something.

| Item | Area | Notes | Priority |
| ---- | ---- | ----- | -------- |
| Trace diagnose engine | trace | `trace get`/`search` are real; `diagnose`/`eval-set`/`schema` (rule engine + LLM-as-judge via local `claude`, rubric/artifact persistence) are a large standalone feature, still stubbed. Implement as its own multi-phase slice (ref kweaver-sdk src/trace-ai). | High |
| agent chat streaming | agent | `agent chat`/`trace`/`skill` still stubbed. Chat is a 681-line JSON-patch SSE protocol (key-path `upsert` deltas, segment/progress accumulation) — NOT plain OpenAI deltas. Own slice. Model streaming (`model llm chat --stream`) IS done and live-verified. | High |
| bkn validate + create-from | bkn | `push`/`pull` done (local tar, live-verified). `validate` needs the full `@kweaver-ai/bkn` network model (loadNetwork/validateNetwork/checksum); `create-from-catalog`/`create-from-csv` are multi-step orchestration; `relation-type-paths` needs endpoint confirmation. Still stubbed. | Medium |
| Admin destructive writes | admin | Reads done + live-verified (org list/get/members, user list/get/roles, role list/get/members). Writes (user/org create/update/delete via ISFWeb thrift `Usrm_Add*`/`Edit*` with caller-UUID; `reset-password` needs RSA1024 encryption from EACP) still stubbed — destructive + not live-testable per constraint, so deferred to a mock-only slice. | Medium |
| Real-backend regression | api | Read paths re-validated live (`test/e2e/live-smoke.sh`; `bkn search` byte-identical to legacy). Admin reads, bkn push/pull, model streaming chat all live-verified on the VM this round. Note: `kweaver token` refresh on a self-signed platform needs `NODE_TLS_REJECT_UNAUTHORIZED=0`. | Medium |
| tool/skill/dataflow uploads | commands | `skill register`/`download`/`install`/`update-*`/`republish`, `tool upload`, `dataflow create*`/`templates` need multipart/zip handling. Stubbed. | Low |
| Output formatting | utils | Commands print raw backend JSON; add human table formatting for non-`--json` output. | Low |
| explore command | cli | Legacy `explore` launches a local web UI — out of backend-only scope. Keep as stub or drop. | Low |
| context query helpers | context | `query-instance-subgraph`/`get-logic-properties`/`get-action-info` still stubbed (need exact MCP tool names/args). Standard MCP `resources`/`templates`/`prompts` ARE wired (server on the dev VM doesn't advertise those capabilities). | Low |
| audit (eacp login-log) | admin | `admin audit list` code is correct but this deploy's gateway returns 404 / the eacp upstream (`192.168.2.213`) is cluster-internal & unreachable. Backend/network issue, not a code bug. | Low |

When an item is fixed, delete its row (git history keeps the record).
