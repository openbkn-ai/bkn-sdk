# Troubleshooting

- **401 / not authorized** — re-`auth login`; token mode doesn't auto-refresh. `-k` for self-signed TLS; scripts refreshing tokens may need `NODE_TLS_REJECT_UNAUTHORIZED=0`.
- **Empty lists** — wrong business domain; pass `-bd <domain>`.
- **403 on a specific box/resource** — owned by another user/domain (impex/upload).
- **`discover only supports physical catalogs`** — `create-from-*` needs a physical (datasource-backed) catalog, not a logical one.
- **`no such index ss4o_traces-…`** — the deploy's trace index isn't populated; `trace get`/`diagnose` have no data.
- **EACP unreachable (`audit`, `change-password`)** — the eacp upstream is cluster-internal on some deploys.
- **Wide-table JSON truncation** — pass a small `--limit`/`condition` to `object-type query`.
