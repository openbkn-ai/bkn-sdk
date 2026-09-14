# Vega Resource CLI Alignment

## Intent

Align the public SDK and CLI with the current Vega Backend resource and build-task contracts.

## Decisions

- Resource index configuration is part of `PUT /resources/{id}` and is exposed through resource update, not a separate configure operation.
- Starting a build is a Resource action: `vega resource build <resource-id>`.
- BuildTask lifecycle operations use a dedicated `vega build-task` group with `list`, `get`, `start`, `stop`, and `delete`.
- The obsolete `vega dataset build*` group is removed without compatibility aliases.
- ConnectorType remains read-only in the public SDK/CLI, but list filters and response types match the backend contract.
- Catalog connector-type statistics and local-index capabilities are public read APIs and receive typed SDK/CLI coverage.
- OperationAudit, AuthResources, internal dependency/proxy routes, and ConnectorType writes are out of scope.

## Affected layers

- `api/`: Resource index config types, typed catalog stats/index capabilities/connector reads.
- `resources/`: expose the new reads; keep Resource update as the only index-configuration write.
- `commands/`: reorganize BuildTask commands and complete Resource create/update/delete.
- help/docs/tests: update command discovery, examples, return contracts, and focused regressions.

