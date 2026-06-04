# Tech debt tracker

Running list. Pay down in small PRs. Add a row when you knowingly defer something.

| Item | Area | Notes | Priority |
| ---- | ---- | ----- | -------- |
| Trace diagnose engine | trace | `trace get`/`search` are real; `diagnose`/`eval-set`/`schema` (rule engine + LLM-as-judge via local `claude`, rubric/artifact persistence) are a large standalone feature, still stubbed. Implement as its own multi-phase slice (ref kweaver-sdk src/trace-ai). | High |
| bkn create-from-csv | bkn | `create-from-catalog` DONE (PK detection unit-tested, orchestration wiring live-verified) and `validate` DONE (offline structural check, verified vs examples/06-world-cup). `create-from-csv` remains: it's create-from-catalog preceded by a CSV→catalog import step (multipart upload + dataset creation, then the same build path). | High |
| dataflow templates | dataflow | `dataflow create` (JSON doc) done & live-verified. `templates`/`create-dataset`/`create-bkn` are sugar over `create` that needs the bundled template asset library (kweaver-sdk `src/templates/{dataset,bkn,dataflow}`) — a content port. Stubbed. | Low |
| Output formatting | utils | Commands print raw backend JSON; add human table formatting for non-`--json` output (cli-table3 is already a dep). | Low |
| minor unconfirmed leaves | misc | `skill republish`/`publish-history`, `agent trace`/`skill` stubbed — backend contracts not yet confirmed. | Low |
| Real-backend regression | api | Read paths re-validated live (`test/e2e/live-smoke.sh`; `bkn search` byte-identical to legacy). Live-verified on the VM across this work: admin reads+writes (full org/user lifecycle incl. reset-password + org tree), bkn push/pull + relation-type-paths + resources, model streaming chat + add/edit/delete/test, context MCP + layer-2/3 tools, explore server, skill register/download/install round-trip, tool upload (wiring), dataflow create (wiring), **agent chat non-stream + SSE stream**. Note: `kweaver token` refresh on a self-signed platform needs `NODE_TLS_REJECT_UNAUTHORIZED=0`. | Medium |
| audit (eacp login-log) | admin | `admin audit list` code is correct but this deploy's gateway returns 404 / the eacp upstream (`192.168.2.213`) is cluster-internal & unreachable. Backend/network issue, not a code bug. | Low |

When an item is fixed, delete its row (git history keeps the record).
