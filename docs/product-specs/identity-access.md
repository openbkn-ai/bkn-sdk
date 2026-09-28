# Identity & access (operator)

## Goal

Operator-side management merged from the legacy operator CLI: authentication, organizations, users, roles/permissions, and audit logs.

## User-visible behavior

- `openbkn auth login | logout | status | token | whoami` — OAuth2 (Hydra-style) login; token stored in `~/.bkn/`.
- `openbkn admin org list | tree | get | create | update | delete | members` — departments on bkn-safe `/api/safe/v1/admin/departments`. `create`/`update` send `name`, `parent_id` (create), `manager_id`, `code`, `email`, `remark`; `tree` pages the flat list until it is complete; `members` pages client-side with `--offset/--limit`. There is no `--role`/`--fields` qualifier and no `status`.
- `openbkn admin user list | get | create | update | delete | reset-password` and `user roles <id>`, `assign-role`, `revoke-role` — bkn-safe `/admin/users` and `/admin/role-bindings`. `user list --org` filters by `department_id`. `user create` requires an explicit initial password (`--password`, `--prompt-password`, or `BKN_NEW_USER_PASSWORD`) and sends `telephone`/`department_ids`; there is no default password. Retired ISF fields (code, position, remark, priority, confidentiality level) are not accepted.
- `openbkn admin role list | get | members | create | update | delete | grant-perm | revoke-perm` — bkn-safe `/admin/roles`. `members` names accessor ids by paging the user list until every member is found.
- `openbkn admin audit list` — bkn-safe audit log entries, newest first (`GET /api/safe/v1/admin/audit-logs`, needs `admin-audit:view`) → `{logs, total}`. Filters: `--actor-id --request-id --resource --action --target-id --failed-only --from --to --before-id --offset --limit` (CLI default 30, max 500; `--start`/`--end` are hidden aliases of `--from`/`--to`). The earlier `--user/--page/--size` flags are gone: the API filters by actor id, not name, and pages by offset/limit.
- `openbkn admin row-filter get|apply|delete|explain` — Enterprise fixed-condition object-instance row filtering on bkn-safe. Policies target one user or role and one canonical `<knowledge-network-id>/<object-type-id>` reference. `get` returns the opaque optimistic-lock revision; `apply` and `delete` send that value through `--expected-revision` and never retry a `409 revision_conflict`. `apply` reads the SDK-shaped `{relation, conditions}` policy from `--body` or `--body-file`. The tokenless runtime `/api/safe/v1/authz/row-filters` decision endpoint is cluster-internal and is deliberately absent from the SDK and CLI.
- `openbkn admin audit get <id>` — one audit log entry.
- `openbkn config show | set` — base URL, TLS, defaults.
- `openbkn auth login` / `whoami` name the caller from the token's `preferred_username`, else the self-service `GET /api/safe/v1/me` — never the admin-only `GET /admin/users/{id}`, which 403s for a non-admin and is recorded as an audit refusal.

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
