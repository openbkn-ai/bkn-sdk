# Tech debt tracker

Running list. Pay down in small PRs. Add a row when you knowingly defer something.

| Item | Area | Notes | Priority |
| ---- | ---- | ----- | -------- |
| Stubbed commands | commands | `auth`, `config`, `vega`, `call` are real; rest of the tree is `stubs.ts`. | High |
| Real backend smoke | api | `call` validated over real HTTP (public echo). BKN service paths (vega `/api/vega/v1`, `/build-tasks`, auth) still unverified against a live platform — needs user base-url + token. | High |
| Operator-side flags | commands | The 38 failing equivalence cases are all `kweaver-admin` depth-2 flag-coverage: org/user/role/model(llm,small)/audit/config-set + auth login/whoami/change-password. Add real flags + handlers (Phase 4). | High |
| Auth OAuth flows | auth | Deferred until a deployed env exists. `auth login --token` works; browser OAuth2 + password signin staged in `auth/oauth.ts`. Reference kweaver-sdk login + prompt UX when implementing. | Low |
| Profile + user-scope polish | config | Store is now multi-user (`platforms/<b64url(url)>/users/<userId>/`, `state.json`, `BKN_PROFILE`). Still TODO: `--user` switch command surface + `auth users`/`switch` wiring to activeUsers. | Medium |
| `-bd` short flag | cli | Legacy uses `-bd`; commander shorts are single-char, so only `--biz-domain` is wired. Add `-bd` alias for equivalence. | Medium |
| build-tasks base path | api/vega | `VEGA_BASE = /api/vega/v1` is a guess; confirm `/build-tasks` path against live API. | Medium |
| Version single-source | cli | `cli.ts` hardcodes `0.1.0`; read from `package.json` once JSON import is wired. | Low |
| Legacy behavior audit | resources | Decide per-domain what to keep vs drop from `kweaver-sdk`/`kweaver-admin` | Medium |

When an item is fixed, delete its row (git history keeps the record).
