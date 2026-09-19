# Troubleshooting

- **401 / not authorized** — re-`auth login`; `--token` mode doesn't auto-refresh.
- **TLS certificate rejected** — self-signed platform: log in with `auth login -k <url>` and it's remembered per platform, so later commands need no `-k`. Don't reach for `NODE_TLS_REJECT_UNAUTHORIZED`: `-k` is scoped to that platform's requests, while the env var disables verification for the whole process.
- **`ECONNREFUSED` / 429 / 502 / 503 while a gateway restarts or throttles** — the CLI retries 3 times (a stderr line per retry); a write is retried only when the connection was never made. `--no-retry` fails at once.
- **Empty lists** — confirm the current account's grants and the target resource.
- **403 on a specific box/resource** — owned by another user or outside the current account's grants (impex/upload).
- **`discover only supports physical catalogs`** — `create-from-*` needs a physical (datasource-backed) catalog, not a logical one.
- **`trace get`/`diagnose` return no spans** — they read the typed `/api/agent-observability/v1/traces` API, so missing data is an empty list, not an index error. Check `trace search --conversation-id <id>`; an empty `entries` means nothing was recorded for that conversation on this deploy.
- **`403` on `admin audit list`** — the account lacks `admin-audit:view`. Audit and `auth change-password` both go to bkn-safe; neither touches EACP any more.
- **A bare nginx `404 Not Found` HTML page** — that service isn't installed on the deploy, so the command has nothing to talk to. Deploys vary in which optional services they ship.
- **`skill content` / `read-file` says `skill not found`** — the skill is still `unpublish`. Read it with `--draft` first (read-only); publishing with `skill set-status <id> published` is a write — confirm before running it. The URLs they return point at the in-cluster MinIO host and only resolve from inside the cluster.
- **Wide-table JSON truncation** — pass a small `--limit`/`condition` to `object-type query`.
