# Tech debt tracker

Running list. Pay down in small PRs. Add a row when you knowingly defer something.

| Item | Area | Notes | Priority |
| ---- | ---- | ----- | -------- |
| change-password live check | auth | `auth change-password` (EACP `POST /api/eacp/v1/auth1/modifypassword`, RSA old+new) is wired against a **live** route — the endpoint exists (a junk body returns `RSA_private_decrypt error … ncEACHttpServerUtil.cpp`, i.e. it reaches EACP's decrypt, vs a real 404's `Fail to find method`). Not run end-to-end only because it would change the admin password; the same RSA key is proven by `admin user reset-password` (live 200). | Low |
| Trace scan synthesizer | trace | `trace scan` does batch-diagnose + a recurring-rule tally. The legacy cross-trace LLM *synthesizer* (narrative across traces) is not ported — the per-trace synthesizer + the scan tally cover the common case. | Low |
| Real-backend regression | api | Read paths re-validated live (`test/e2e/live-smoke.sh`; `bkn search` byte-identical to legacy). Live-verified on the VM across this work: admin reads+writes (full org/user lifecycle incl. reset-password + tree), bkn push/pull/relation-type-paths/resources/validate, model streaming chat + CRUD, context MCP + layer-2/3, explore server, skill register/download/install round-trip + republish/publish-history, tool upload, toolbox export/import (wiring), dataflow create + templates/create-dataset (created a real dataset), agent chat (stream) + skill list, **trace diagnose symbolic + rubric + synthesizer via local `claude`**, eval-set build+test (real agent + claude semantic judge). create-from-catalog/csv orchestration wiring verified (full real-table runs need a physical Vega catalog, none on this VM). Note: `openbkn token` refresh on a self-signed platform needs `NODE_TLS_REJECT_UNAUTHORIZED=0`. | Medium |
| audit (eacp login-log) | admin | `admin audit list` posts to `/api/eacp/v1/auth1/login-log`, which returns a true 404 (`Fail to find method`) on this deploy — the route isn't registered (EACP itself is up: `user/get` 200, `modifypassword` reachable). Confirm the current login-log route/service and repoint. | Low |

When an item is fixed, delete its row (git history keeps the record).
