# Object metrics V1 client migration

## Scope and accepted approach

The requester chose to retire the legacy `/metrics` implementation and migrate SDK and agent callers to Object Metrics V1. Old metric data is converted by the Foundry upgrade script; definitions that cannot be converted losslessly remain in `manual_review`. No runtime compatibility layer or source-data deletion is part of this change.

Replace the SDK's `bkn metric` surface with `bkn object-metric` and use the V1 object-metric endpoints. This is a breaking client change that follows the coordinated Foundry endpoint retirement. The SDK must not silently translate an old metric definition or query into the new schema, because the new definition lifecycle and runtime query capabilities have different semantics.

The new client exposes draft creation and update, listing and version reads, validation, trial, published version query, publish, deprecate, and draft deletion. A data query requires an explicit positive version. A trial requires `{definition, query}`. Writes send a single definition, not `{entries:[...]}`, and do not send legacy import-mode, strict-mode, or method-override headers. Validation parses the V1 `{valid, issues, output_shape}` result and keeps a completed `valid: false` as a result; the CLI exits nonzero for it.

## Layer boundaries

- `api/object-metrics.ts`: endpoint paths, query flags, request and response boundary validation.
- `resources/knowledge-networks.ts`: public SDK methods delegating to the API layer.
- `commands/bkn.ts`: self-describing `object-metric` CLI group and flags; no direct HTTP.
- Product spec, tests, CLI help sources, and generated return descriptions follow the new contract.

No data migration runs from the SDK. No dependency or Node engine changes.

## Risks and verification

Older SDK consumers using `metric*` methods or `bkn metric` must adopt the new client surface. The CLI must make the required version visible in help and reject an invalid version before a request. Tests cover URLs, version pinning, body shape, invalid validation results, and the absence of calls to retired `/metrics` paths. Run lint, unit tests, build, and inspect `openbkn describe bkn object-metric`.
