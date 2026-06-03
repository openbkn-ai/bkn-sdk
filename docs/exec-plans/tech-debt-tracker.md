# Tech debt tracker

Running list. Pay down in small PRs. Add a row when you knowingly defer something.

| Item | Area | Notes | Priority |
| ---- | ---- | ----- | -------- |
| Trace diagnose engine | trace | `trace get`/`search` are real; `diagnose`/`eval-set`/`schema` (rule engine + LLM-as-judge via local `claude`, rubric/artifact persistence) are a large standalone feature, still stubbed. Implement as its own multi-phase slice (ref kweaver-sdk src/trace-ai). | High |
| agent chat streaming | agent | `agent chat`/`trace`/`skill` still stubbed. Chat is a 681-line JSON-patch SSE protocol (key-path `upsert` deltas, segment/progress accumulation) — NOT plain OpenAI deltas. Own slice. Model streaming (`model llm chat --stream`) IS done and live-verified. | High |
| bkn validate + create-from | bkn | `push`/`pull`/`relation-type-paths`/`resources` done & live-verified. `validate` needs the full `@kweaver-ai/bkn` network model (loadNetwork/validateNetwork/checksum); `create-from-catalog`/`create-from-csv` are multi-step orchestration (~400 lines each in kweaver-sdk bkn-ops). Still stubbed. | Medium |
| tool/skill/dataflow uploads | commands | `skill register`/`download`/`install`/`update-*`/`republish`/`publish-history`, `tool upload`, `dataflow create*`/`templates` need multipart/zip handling. Stubbed. | Low |
| Output formatting | utils | Commands print raw backend JSON; add human table formatting for non-`--json` output. | Low |
| Real-backend regression | api | Read paths re-validated live (`test/e2e/live-smoke.sh`; `bkn search` byte-identical to legacy). This round live-verified on the VM: admin reads+writes (full org/user lifecycle incl. reset-password), bkn push/pull + relation-type-paths + resources, model streaming chat, context MCP + layer-2/3 tools, explore server. Note: `kweaver token` refresh on a self-signed platform needs `NODE_TLS_REJECT_UNAUTHORIZED=0`. | Medium |
| audit (eacp login-log) | admin | `admin audit list` code is correct but this deploy's gateway returns 404 / the eacp upstream (`192.168.2.213`) is cluster-internal & unreachable. Backend/network issue, not a code bug. | Low |

When an item is fixed, delete its row (git history keeps the record).
