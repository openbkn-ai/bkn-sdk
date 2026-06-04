# Tech debt tracker

Running list. Pay down in small PRs. Add a row when you knowingly defer something.

| Item | Area | Notes | Priority |
| ---- | ---- | ----- | -------- |
| Trace LLM-judge pillar | trace | `trace get`/`search` + **`diagnose` (symbolic, rules-only)** DONE — 5 builtin predicates, 8 unit tests, wiring live-verified. Remaining: the LLM-as-judge half — rubric rules + synthesizer (the ~3240-line `exp` agent-provider layer), plus `eval-set` (build/test) and `scan`. Each is its own slice (ref kweaver-sdk src/trace-ai). | High |
| dataflow templates | dataflow | `dataflow create` (JSON doc) done & live-verified; `create-dataset`/`create-bkn` are now also covered by `bkn create-from-csv`/`create-from-catalog`. `templates`/`create-dataset`/`create-bkn` (the template-library sugar) need the bundled template assets (kweaver-sdk `src/templates/{dataset,bkn,dataflow}`) — a content port. Stubbed. | Low |
| Output formatting | utils | Commands print raw backend JSON; add human table formatting for non-`--json` output (cli-table3 is already a dep). | Low |
| minor unconfirmed leaves | misc | `skill republish`/`publish-history`, `agent trace`/`skill` stubbed — backend contracts not yet confirmed. | Low |
| Real-backend regression | api | Read paths re-validated live (`test/e2e/live-smoke.sh`; `bkn search` byte-identical to legacy). Live-verified on the VM across this work: admin reads+writes (full org/user lifecycle incl. reset-password + org tree), bkn push/pull + relation-type-paths + resources, model streaming chat + add/edit/delete/test, context MCP + layer-2/3 tools, explore server, skill register/download/install round-trip, tool upload (wiring), dataflow create (wiring), **agent chat non-stream + SSE stream**, bkn create-from-catalog/create-from-csv (orchestration wiring — full real-table runs need a physical Vega catalog, none on this VM), bkn validate (vs examples/06-world-cup). Note: `kweaver token` refresh on a self-signed platform needs `NODE_TLS_REJECT_UNAUTHORIZED=0`. | Medium |
| audit (eacp login-log) | admin | `admin audit list` code is correct but this deploy's gateway returns 404 / the eacp upstream (`192.168.2.213`) is cluster-internal & unreachable. Backend/network issue, not a code bug. | Low |

When an item is fixed, delete its row (git history keeps the record).
