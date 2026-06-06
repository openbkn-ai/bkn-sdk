# `openbkn admin` → bkn-safe migration

ISF is retired. The `admin` group moved off the four ISF base paths
(`/api/user-management/v1`, `/api/authorization/v1`, `/isfweb/api/ShareMgnt`,
`/api/eacp/v1`) onto bkn-safe's **token-gated admin API** `/api/safe/v1/admin/*`.
`src/api/safe.ts` holds the client; `src/resources/admin.ts` maps each command.

## Auth gate

Every `/admin/*` call needs `Authorization: Bearer <token>` (the CLI attaches it)
and the subject must be an admin (super-admin today). `401` = no/invalid token,
`403` = not an admin. Get a token via the normal `openbkn auth login` device flow.

## Status

**Migrated (all but audit).** Response shapes: `{users|roles|departments, total}`;
department `parent_id` (not ISF `parent_deps[]`); ids-only for role bindings/members.

| group | commands | endpoint |
| --- | --- | --- |
| user | list/get/create/update/delete/reset-password/roles/assign-role/revoke-role | `GET/POST/PUT/DELETE /admin/users[/:id[/password]]`, `…/role-bindings` |
| org | list/get/tree/members/create/update/delete | `…/admin/departments[/:id[/members]]` |
| role | list/get/members/add-member/remove-member | `…/admin/roles[/:id[/members]]`, `…/role-bindings` |
| role (new) | create/update/delete | `POST/PUT/DELETE /admin/roles[/:id]` |
| audit | list | **none** — login-log retired by design → `notOnSafe` (clear error, non-zero exit) |

Lossy mappings (bkn-safe takes fewer fields): `user create` sends account + a
default initial password (`openbkn`, forced-change on first login), drops
dept/code/position; `user update` keeps name/email/telephone; `org create/update`
keeps name/parent. New users/roles are created custom; built-in roles
(system/business) reject update/delete/permission edits with `403`.

## Behavioral notes (per bkn-safe API.md)

1. `getUserRoles` / `roleMembers` return **ids only** — enrich names via
   `GET /admin/roles` (id→name cache) or `findUserByAccount`.
2. Built-in roles immutable (`built_in:true`, source system/business) → 403.
3. `org delete` is non-cascade → `409` when the department has children/members.
4. Pagination: users limit ≤500, departments ≤1000, roles return all (filter
   client-side; the old ISF `role` query param is dropped).
5. No RSA/thrift: `setUserPassword` and `change-password` send plaintext over TLS.

## Verification

- `src/api/safe.ts`: 12 unit tests (mock fetch) assert path/method/body for each
  endpoint. `audit list` → notOnSafe verified live.
- Token-gated endpoints not yet live-verified end-to-end: needs a fresh admin
  token, and the spec notes the `adminv2` image deploy was pending (`GET
  /admin/users`, `/departments/:id[/members]`, `?account=` 404 until redeployed).
  Re-run once a super-admin token is available against the deployed image.
