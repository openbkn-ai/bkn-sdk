# Tech debt tracker

Running list. Pay down in small PRs. Add a row when you knowingly defer something.

| Item | Area | Notes | Priority |
| ---- | ---- | ----- | -------- |
| Output formatting | utils | Every command prints backend JSON (`--json`/default). Legacy `kweaver` renders some lists as tables; matching those formats exactly is deferred to avoid CLI-equivalence drift, and JSON is the safe machine-readable default. `cli-table3` is already a dep if/when we add opt-in tables. | Low |
| Operator auth | admin | `admin auth` (login/logout/status/whoami/list/change-password/token) intentionally stubbed — operators reuse the top-level `openbkn auth` (per product decision). OAuth/Hydra flow not ported. | Low |
| Trace scan synthesizer | trace | `trace scan` does batch-diagnose + a recurring-rule tally. The kweaver-sdk cross-trace LLM *synthesizer* (narrative across traces) is not ported — the per-trace synthesizer + the scan tally cover the common case. | Low |
| Real-backend regression | api | Read paths re-validated live (`test/e2e/live-smoke.sh`; `bkn search` byte-identical to legacy). Live-verified on the VM across this work: admin reads+writes (full org/user lifecycle incl. reset-password + tree), bkn push/pull/relation-type-paths/resources/validate, model streaming chat + CRUD, context MCP + layer-2/3, explore server, skill register/download/install round-trip + republish/publish-history, tool upload, toolbox export/import (wiring), dataflow create + templates/create-dataset (created a real dataset), agent chat (stream) + skill list, **trace diagnose symbolic + rubric + synthesizer via local `claude`**, eval-set build+test (real agent + claude semantic judge). create-from-catalog/csv orchestration wiring verified (full real-table runs need a physical Vega catalog, none on this VM). Note: `kweaver token` refresh on a self-signed platform needs `NODE_TLS_REJECT_UNAUTHORIZED=0`. | Medium |
| audit (eacp login-log) | admin | `admin audit list` code is correct but this deploy's gateway returns 404 / the eacp upstream (`192.168.2.213`) is cluster-internal & unreachable. Backend/network issue, not a code bug. | Low |

When an item is fixed, delete its row (git history keeps the record).
