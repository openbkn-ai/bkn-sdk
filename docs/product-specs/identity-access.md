# Identity & access (operator)

## Goal

Operator-side management merged from the legacy operator CLI: authentication, organizations, users, roles/permissions, and audit logs.

## User-visible behavior

- `openbkn auth login | logout | status | token | whoami` — OAuth2 (Hydra-style) login; token stored in `~/.bkn/`.
- `openbkn admin org list | tree | get | create | update | delete | members` — departments on bkn-safe `/api/safe/v1/admin/departments`. `create`/`update` send `name`, `parent_id` (create), `manager_id`, `code`, `email`, `remark`; `tree` pages the flat list until it is complete; `members` pages client-side with `--offset/--limit`. There is no `--role`/`--fields` qualifier and no `status`.
- `openbkn admin user list | get | create | update | delete | reset-password` and `user roles <id>`, `assign-role`, `revoke-role` — bkn-safe `/admin/users` and `/admin/role-bindings`. `user list --org` filters by `department_id`. `user create` requires an explicit initial password (`--password`, `--prompt-password`, or `BKN_NEW_USER_PASSWORD`) and sends `telephone`/`department_ids`; there is no default password. Retired ISF fields (code, position, remark, priority, confidentiality level) are not accepted.
- `openbkn admin role list | get | members | create | update | delete | grant-perm | revoke-perm` — bkn-safe `/admin/roles`. `members` names accessor ids by paging the user list until every member is found.
- `openbkn admin audit list` — operation audit records, newest first, from the observability service (`GET /api/observability/v1/logs`, categories `audit.admin` + `audit.security` by default; needs the audit access profile) → `{data, next_cursor, partial, count, pagination, source_status}`. Filters: `--category --q --actor-id --actor --request-id --action --target-type --target-id --outcome --failed-only --from --to --page --cursor --limit` (CLI default 30, range 20..200; `--start`/`--end` are hidden aliases of `--from`/`--to`). `--failed-only` is sent as `outcomes=failure,denied`. Retired with the bkn-safe `/admin/audit-logs` reader: `--resource` (use `--target-type`), `--before-id`/`--offset` (use `--page`/`--cursor`); `{logs,total}` is now the envelope above.
- `openbkn admin row-filter get|apply|delete|explain` — Enterprise fixed-condition object-instance row filtering on bkn-safe. Policies target one user or role and one canonical `<knowledge-network-id>/<object-type-id>` reference. `get` returns the opaque optimistic-lock revision; `apply` and `delete` send that value through `--expected-revision` and never retry a `409 revision_conflict`. `apply` reads the SDK-shaped `{relation, conditions}` policy from `--body` or `--body-file`. The tokenless runtime `/api/safe/v1/authz/row-filters` decision endpoint is cluster-internal and is deliberately absent from the SDK and CLI.
  User explanations normalize an omitted `role_policy_only` to `rolePolicyOnly: false`
  (explicit false is also accepted). Role explanations require true. Non-boolean
  flags and flags inconsistent with the requested subject remain response errors.
- `openbkn admin audit get <id>` — one record by `event_id` (`GET /api/observability/v1/logs/{event_id}`) → `{data, field_projection, request_trace_context}`; `client_ip` is redacted unless the caller may see sensitive fields.
- `openbkn config show | set` — base URL, TLS, defaults.
- `openbkn auth login` / `whoami` name the caller from the token's `preferred_username`, else the self-service `GET /api/safe/v1/me` — never the admin-only `GET /admin/users/{id}`, which 403s for a non-admin and is recorded as an audit refusal.

## Role model

- A small set of string roles maps to UUID system roles (carried over from the admin tool). Document the mapping here as it's finalized.

## SDK touchpoints

- `resources/` identity surface over user/org/role/audit clients; OAuth in `auth/oauth.ts`; token + base-url resolution in `config/`.

## Edge cases

- Operator endpoints require an operator token; a user token → clear 403 pointing to the right login.
- Audit output may contain identifiers — treat as sensitive, support `--json`.
- Audit record fields are parsed leniently (unknown fields kept); `count.value` is a plain number.
- One batch mutation may write one audit record per target, all sharing a `request_id`; `count` counts records, not requests.
- 401/403 → guide to `openbkn auth login`; never silent-retry.
