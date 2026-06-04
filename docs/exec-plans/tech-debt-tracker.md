# Tech debt tracker

Running list. Pay down in small PRs. Add a row when you knowingly defer something.

| Item | Area | Notes | Priority |
| ---- | ---- | ----- | -------- |
| Operator auth alias | admin | `admin auth` leaves are stubbed by design — operators use the top-level `openbkn auth` (now full: token + browser PKCE + headless password OAuth + switch/users/export/change-password). `admin auth` could be wired as a thin alias if a 1:1 mapping is wanted. | Low |
| change-password live check | auth | `auth change-password` (EACP `modifypassword`, RSA old+new) is wired but not live-verified — this deploy's EACP upstream (`192.168.2.213`) is cluster-internal/unreachable (same cause as `admin audit`). Re-verify on a cluster where EACP is reachable. | Low |
| Trace scan synthesizer | trace | `trace scan` does batch-diagnose + a recurring-rule tally. The kweaver-sdk cross-trace LLM *synthesizer* (narrative across traces) is not ported — the per-trace synthesizer + the scan tally cover the common case. | Low |
| Real-backend regression | api | Read paths re-validated live (`test/e2e/live-smoke.sh`; `bkn search` byte-identical to legacy). Live-verified on the VM across this work: admin reads+writes (full org/user lifecycle incl. reset-password + tree), bkn push/pull/relation-type-paths/resources/validate, model streaming chat + CRUD, context MCP + layer-2/3, explore server, skill register/download/install round-trip + republish/publish-history, tool upload, toolbox export/import (wiring), dataflow create + templates/create-dataset (created a real dataset), agent chat (stream) + skill list, **trace diagnose symbolic + rubric + synthesizer via local `claude`**, eval-set build+test (real agent + claude semantic judge). create-from-catalog/csv orchestration wiring verified (full real-table runs need a physical Vega catalog, none on this VM). Note: `kweaver token` refresh on a self-signed platform needs `NODE_TLS_REJECT_UNAUTHORIZED=0`. | Medium |
| audit (eacp login-log) | admin | `admin audit list` code is correct but this deploy's gateway returns 404 / the eacp upstream (`192.168.2.213`) is cluster-internal & unreachable. Backend/network issue, not a code bug. | Low |

When an item is fixed, delete its row (git history keeps the record).
