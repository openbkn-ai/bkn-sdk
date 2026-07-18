# Troubleshooting

- **401 / not authorized** — re-`auth login`; `--token` mode doesn't auto-refresh.
- **TLS certificate rejected** — self-signed platform: log in with `auth login -k <url>` and it's remembered per platform, so later commands need no `-k`. Don't reach for `NODE_TLS_REJECT_UNAUTHORIZED`: `-k` is scoped to that platform's requests, while the env var disables verification for the whole process.
- **Empty lists** — wrong business domain; pass `-bd <domain>`.
- **403 on a specific box/resource** — owned by another user/domain (impex/upload).
- **`discover only supports physical catalogs`** — `create-from-*` needs a physical (datasource-backed) catalog, not a logical one.
- **`no such index ss4o_traces-…`** — the deploy's trace index isn't populated; `trace get`/`diagnose` have no data.
- **EACP unreachable (`audit`, `change-password`)** — the eacp upstream is cluster-internal on some deploys.
- **Wide-table JSON truncation** — pass a small `--limit`/`condition` to `object-type query`.
