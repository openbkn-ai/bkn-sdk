# Row-filter management SDK design

## Intent

Expose the Enterprise fixed-condition row-filter management API through the
typed TypeScript SDK and the operator CLI. Keep the tokenless runtime decision
endpoint private to trusted cluster workloads.

## Contract boundary

- Public management surface:
  - `GET /api/safe/v1/admin/row-filter-policies`
  - `PATCH /api/safe/v1/admin/row-filter-policies`
  - `POST /api/safe/v1/admin/row-filter-policies/explain`
- Private runtime surface, deliberately excluded from the SDK and CLI:
  - `POST /api/safe/v1/authz/row-filters`

The SDK uses camelCase names while translating to the backend's snake_case
wire contract. A policy contains one flat `and` or `or` relation and one to
five fixed conditions. Deletion sends `policy: null`. The caller supplies the
last observed revision; the SDK does not retry a `409 revision_conflict` or
overwrite another administrator's update.

## Layering

1. `src/api/safe.ts` owns wire conversion, response validation, and HTTP calls.
2. `src/resources/admin.ts` exposes typed programmatic methods.
3. `src/commands/admin.ts` exposes `openbkn admin row-filter` commands.
4. `src/index.ts` exports the public row-filter types.

The CLI accepts policy JSON through `--body` or `--body-file`. This avoids a
second mini-language for condition values and keeps the JSON shape identical to
the SDK policy type. Read and explain commands are non-mutating; apply and
delete are writes.

## Safety and compatibility

- Inputs and responses are validated at the API boundary.
- Integer values must be safe integers; values are never coerced between
  strings, integers, and booleans.
- The internal tokenless decision endpoint is not exported.
- Adding methods and commands is backward compatible.
- Enterprise licensing and authorization remain server-side decisions.
