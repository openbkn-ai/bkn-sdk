# Tech debt tracker

Running list. Pay down in small PRs. Add a row when you knowingly defer something.

| Item | Area | Notes | Priority |
| ---- | ---- | ----- | -------- |
| Write mutations | commands | Read surface is real across all user-side domains; create/update/delete/publish/push/pull and tool execute / agent chat are still stubs. Fill with verified POST/PUT bodies (live env available). | High |
| Trace AI engine | trace | `trace diagnose`/`eval-set`/`schema` is a large standalone feature (rule engine + LLM-as-judge via local `claude`). Still stubbed; implement as its own slice. | Medium |
| Admin operator subtree | commands | `openbkn admin` org/user/role/audit/llm/small-model are stubs (38 equivalence flag-coverage cases). Deferred — operator endpoints need an env to test. | Medium |
| Auth OAuth flows | auth | `auth login --token` works; browser OAuth2 + password signin staged in `auth/oauth.ts`. Reference kweaver-sdk login + prompt UX. | Low |
| `-bd` short flag | cli | commander shorts are single-char; only `--biz-domain` wired. Add `-bd` alias for equivalence. | Medium |
| TLS per-request dispatcher | api/tls | `--insecure` flips NODE_TLS_REJECT_UNAUTHORIZED process-wide; move to a per-request undici dispatcher so SDK use doesn't mutate a global. | Low |
| Output formatting | utils | Commands print raw backend JSON; legacy formats human tables for some lists. Add table formatting for non-`--json` output. | Low |
| Version single-source | cli | `cli.ts` hardcodes `0.1.0`; read from `package.json`. | Low |
| CI + README | infra | No `.github/` workflow; README is a stub. | Medium |

When an item is fixed, delete its row (git history keeps the record).
