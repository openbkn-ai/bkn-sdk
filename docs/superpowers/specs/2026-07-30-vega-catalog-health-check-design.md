# Vega Catalog health-check contract alignment

## Intent

Align the SDK and CLI with the Catalog connection-test and health-check schedule
contracts introduced by bkn-foundry issue 261.

## Scope

- Add connection preflight for an unpersisted connector configuration.
- Parse the business result returned by both connection-test endpoints.
- Support `allow_unhealthy` on Catalog create and update.
- Support a health-check schedule during Catalog creation and through its
  dedicated GET/PUT endpoints.
- Correct the health-status API from an unsupported comma-joined multi-ID path
  to the backend's single-Catalog contract.
- Correct Catalog update serialization so the path ID is always included in the
  full PUT body and cannot disagree with it.
- Remove the deleted `health_check_enabled` output-column reference.

## Design

`api/vega.ts` owns the backend-facing request mapping and Zod response schemas.
SDK inputs remain camelCase and are converted to the backend snake_case
contract. Connection tests use a 60-second client timeout because the backend
performs a synchronous connector probe.

Catalog update accepts a complete update request rather than hydrating omitted
fields from GET. Hydration is rejected because Catalog GET responses may redact
encrypted connector fields; replaying such a response could corrupt credentials.
The API function injects the path ID into the request body.

`resources/vega.ts` exposes the new operations without CLI concerns. The CLI
adds explicit preflight and schedule commands plus create/update flags. Catalog
update requires the backend's full fields (`name`, `connector-type`, `enabled`)
instead of pretending PUT is a partial update.

## Compatibility

The `updateCatalog` SDK input becomes stricter to match the existing backend PUT
contract. Callers that previously passed partial fields must supply the required
full fields. No backend, database, or configuration changes are introduced.
