# Identity & access (operator)

## Goal

Operator-side management merged from `kweaver-admin`: authentication, organizations, users, roles/permissions, and audit logs.

## User-visible behavior

- `openbkn auth login | logout | status | token` — OAuth2 (Hydra-style) login; token stored in `~/.bkn/`.
- `openbkn org list | tree | get | create | update | delete | members` — organization management.
- `openbkn user list | get | create | update | delete` and `user roles <id>`, `assign-role`, `revoke-role`.
- `openbkn role list` — system roles.
- `openbkn audit list` — audit log entries (limit 30).
- `openbkn config show | set` — base URL, TLS, defaults.

## Role model

- A small set of string roles maps to UUID system roles (carried over from the admin tool). Document the mapping here as it's finalized.

## SDK touchpoints

- `resources/` identity surface over `api/business-domains.ts` and user/org/role/audit clients; OAuth in `auth/oauth.ts`; token + base-url resolution in `config/`.

## Edge cases

- Operator endpoints require an operator token; a user token → clear 403 pointing to the right login.
- Audit output may contain identifiers — treat as sensitive, support `--json`.
- 401/403 → guide to `openbkn auth login`; never silent-retry.
