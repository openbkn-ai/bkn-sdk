# Vega SDK API Coverage Design

## Scope

This change completes the Vega SDK surface needed by issue 461 without splitting follow-up work:

1. DiscoverSchedule CRUD, enable/disable actions, and optimistic updates.
2. Typed Catalog and Resource responses, including `update_time`.
3. DiscoverTask and SemanticUnderstandingTask lifecycle APIs.
4. Typed Resource creation and ResourceData query/document operations.

ConnectorType writes and AuthResource are explicitly out of scope.

## Design

- Keep transport functions aligned one-to-one with the Vega OpenAPI operations.
- Parse response bodies with forward-compatible Zod schemas (`passthrough`) at the API boundary.
- Preserve backend field names in response types and use camelCase SDK request/options mapped to wire names.
- Model PUT requests as full replacements where the server requires them. DiscoverSchedule update therefore requires `catalogId` and `enabled`, and accepts `expectedUpdateTime` from the latest `update_time`.
- Keep Resource partial-update convenience behavior: fetch the current typed resource, merge the patch, and send the current `update_time` unless the caller supplies an explicit expected version.
- Expose lifecycle operations through `client.vega` and document operations through `client.resources`.
- Keep destructive batch identifiers as `string | string[]`; encode each identifier separately before joining with commas.

## Protocol baseline

The SDK targets the current Vega OpenAPI directly. This package has no stable release to preserve, so obsolete aliases, legacy synchronous discovery options, and pre-envelope detail responses are not supported. Zod schemas retain unknown additional server fields for forward-compatible additions.

## Verification

- Unit tests cover request mapping, repeated filters, response parsing, optimistic versions, method override headers, and encoded batch identifiers.
- CLI tests cover newly exposed lifecycle commands.
- Run `npm run ci`, `npm run build`, and `git diff --check`.
