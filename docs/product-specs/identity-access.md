# Identity & access (operator)

## Goal

Operator-side management merged from the legacy operator CLI: authentication, organizations, users, roles/permissions, and audit logs.

## User-visible behavior

- `openbkn auth login | logout | status | token` — OAuth2 (Hydra-style) login; token stored in `~/.bkn/`.
- `openbkn org list | tree | get | create | update | delete | members` — organization management.
- `openbkn user list | get | create | update | delete` and `user roles <id>`, `assign-role`, `revoke-role`.
- `openbkn role list` — system roles.
- `openbkn admin audit list` — bkn-safe audit log entries, newest first (`GET /api/safe/v1/admin/audit-logs`, needs `admin-audit:view`) → `{logs, total}`. Filters: `--actor-id --request-id --resource --action --target-id --failed-only --from --to --before-id --offset --limit` (CLI default 30, max 500; `--start`/`--end` are hidden aliases of `--from`/`--to`). The earlier `--user/--page/--size` flags are gone: the API filters by actor id, not name, and pages by offset/limit.
- `openbkn admin audit get <id>` — one audit log entry.
- `openbkn config show | set` — base URL, TLS, defaults.

## Role model

- A small set of string roles maps to UUID system roles (carried over from the admin tool). Document the mapping here as it's finalized.

## SDK touchpoints

- `resources/` identity surface over user/org/role/audit clients; OAuth in `auth/oauth.ts`; token + base-url resolution in `config/`.

## Edge cases

- Operator endpoints require an operator token; a user token → clear 403 pointing to the right login.
- Audit output may contain identifiers — treat as sensitive, support `--json`.
- Audit `total` and `seq` are int64 and are parsed losslessly (bigint when unsafe).
- One batch mutation writes one audit row per target, all sharing a `request_id`; `total` counts rows, not requests.
- 401/403 → guide to `openbkn auth login`; never silent-retry.
