# `openbkn admin` → bkn-safe migration inventory

Handoff for the bkn-safe / server agent. The CLI's `admin` group still targets
the decommissioned ISF services and 503s on every org/user/role/audit call.
bkn-safe exposes a **redesigned** admin surface (`/api/safe/v1/directory` +
`/api/safe/v1/authz`) that is read- and create-heavy but lacks many of the
update/delete/list operations the ISF admin API had.

## What the CLI hit (all 503 now — ISF gone)

| ISF base | Service | Used by |
| --- | --- | --- |
| `/api/user-management/v1` (`UM`) | ISF UserManagement | org + user list/get/create/update/delete |
| `/api/authorization/v1` (`AUTHZ`) | ISF Authorization | role list/get/members, assign/revoke |
| `/isfweb/api/ShareMgnt` (`ISFWEB`) | ISF web (thrift) | some org/user ops |
| `/api/eacp/v1` (`EACP`) | EACP | audit login-log, modifypassword |

Live: `admin user list` / `admin role list` → **503**. `admin llm/small-model`
(model-factory) and `admin auth *` (already on bkn-safe) still work.

## bkn-safe surface available today

```text
directory:  GET  /api/safe/v1/directory/departments
            GET  /api/safe/v1/directory/users/:id
            GET  /api/safe/v1/directory/users/:id/department-ids
            GET  /api/safe/v1/directory/groups/:id/members
            POST /api/safe/v1/directory/names
            POST /api/safe/v1/directory/search-org
            POST /api/safe/v1/directory/users-detail
            POST /api/safe/v1/directory/departments-detail
            POST /api/safe/v1/directory/users           (create)
            PUT  /api/safe/v1/directory/users/:id/password
authz:      POST /api/safe/v1/authz/check
            POST /api/safe/v1/authz/operations
            GET/POST/DELETE /api/safe/v1/authz/policies
            GET  /api/safe/v1/authz/resources
            POST /api/safe/v1/authz/role-bindings        (bind accessor→role)
auth:       /login /consent /device · POST /api/safe/v1/auth/change-password (live)
```

## Command-by-command mapping

Migrated (CLI now calls these; ✅ verified against bkn-safe directly):

| CLI command | bkn-safe endpoint |
| --- | --- |
| `user get <id>` | `GET /directory/users/:id` |
| `user create` | `POST /directory/users` (account+default password `openbkn`; drops dept/code/position — unsupported) |
| `user reset-password` | `PUT /directory/users/:id/password` |
| `user roles <user>` | `POST /directory/users-detail` → `users[0].roles` |
| `user assign-role` / `role add-member` | `POST /authz/role-bindings` |
| `org list` | `GET /directory/departments?parent_id=` |
| `org tree` | walk `GET /departments` from roots (client-side) |
| `org get <id>` | `POST /directory/departments-detail` |

No bkn-safe endpoint — the CLI now returns a clear "not available on bkn-safe"
(via `notOnSafe`) instead of a 503:

| CLI command | why |
| --- | --- |
| `user list` | no user enumeration (`search-org` is id-scoping, not a list) |
| `user update` / `user delete` | only create + password exist |
| `user revoke-role` / `role remove-member` | `role-bindings` is POST-only, no unbind |
| `org create / update / delete` | departments are read-only |
| `org members <id>` | `groups/:id/members` exists but group ≠ department (unconfirmed) |
| `role list` / `role get` / `role members` | no role enumeration (roles are seeded) |
| `audit list` | EACP login-log gone; no bkn-safe audit endpoint |

## Gateway routing gap (blocks the migrated reads)

The migrated CLI targets the right endpoints, verified against bkn-safe
**directly**: `wget http://bkn-safe:3000/api/safe/v1/directory/departments` → 200.
But the **nginx gateway only routes `/api/safe/v1/auth/*`** (login/consent/device/
change-password). `GET https://10.211.55.4/api/safe/v1/directory/departments` and
`/api/safe/v1/authz/*` → 404 at the edge. **Server action:** proxy
`/api/safe/v1/directory` and `/api/safe/v1/authz` to bkn-safe:3000 like
`/api/safe/v1/auth` already is. Until then the ✅ rows below 404 externally even
though the code + bkn-safe handler are correct.

## Gaps to confirm with the server agent

Does bkn-safe intend to provide, or deliberately omit:

1. **User update / delete** — only password PUT + create exist today.
2. **Department create / update / delete** — directory is read-only for depts.
3. **Role enumeration** (`list` / `get` / `members`) — are roles fixed/seeded
   (casbin: 超级管理员 `7dcfcc9c…`) with no CRUD API, or will a list endpoint exist?
4. **Role unbind** (`DELETE /authz/role-bindings` or similar) — currently POST-only.
5. **Audit / login-log** — any bkn-safe replacement for EACP `auth1/login-log`?
6. `org members` — is `directory/groups/:id/members` the department-members
   equivalent, or are groups a separate concept?

## CLI plan (once gaps are settled)

- Migrate the ✅ rows to `/api/safe/v1/...` (different request/response shapes —
  `search-org`/`role-bindings`/`departments-detail` vs the old ISF roles/search).
- For ❌ rows with no bkn-safe endpoint: keep the command but return a clear
  "not available on bkn-safe" error rather than 503 — no pretending.
- Equivalence: the `admin` group was modeled on `kweaver-admin`; migrating to
  bkn-safe will necessarily diverge from that baseline.
