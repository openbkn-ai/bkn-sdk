# Vega SDK API Coverage Execution Plan

Status: completed

## Work items

- [x] Add typed Catalog and Resource schemas and return types.
- [x] Add DiscoverSchedule CRUD/actions with optimistic locking.
- [x] Add DiscoverTask list/get/delete and typed manual trigger.
- [x] Add SemanticUnderstandingTask create/list/get/delete.
- [x] Add typed Resource create and ResourceData query/document operations.
- [x] Expose the APIs through resource namespaces and package exports.
- [x] Add focused API/CLI tests and update Vega product documentation.
- [x] Run lint, typecheck, tests, build, and diff checks.

## Verification result

- `npm run ci`: 505 passed, 1 skipped; lint and typecheck clean.
- `npm run build`: ESM and declaration builds succeeded.
- `git diff --check`: clean.

## Constraints

- Do not add ConnectorType write APIs or AuthResource APIs.
- Do not alter or unstage user-staged changes.
- Do not commit, push, or update the external issue without fresh authorization.
