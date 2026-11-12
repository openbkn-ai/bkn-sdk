# Semantic task apply SDK plan

Design: [SDK surface](../../superpowers/specs/2026-11-12-semantic-task-apply-design.md).

1. Add focused request, public-resource, CLI validation, help, and preview regressions; observe the missing-operation failure.
2. Implement the API request, resource method, public request type, and CLI action without duplicating backend validation.
3. Document the review/apply workflow and backend compatibility requirement.
4. Run affected tests, lint/typecheck, the SDK unit suite, and build; record results and move this plan to completed.

## Verification

- Before implementation, the focused regression run failed on the missing apply API, public resource method, and command.
- `npm test -- --maxWorkers=50% test/unit/vega-semantic.test.ts test/unit/vega-command.test.ts test/unit/help-contract.test.ts test/unit/vega-semantic-dry-run.test.ts`: 111 tests passed.
- `npm run lint`: passed, including TypeScript checking.
- `npm test -- --maxWorkers=50%`: 1508 tests passed; one existing optional live test skipped.
- `npm run build`: passed, including declaration generation.
- `node dist/cli.js describe vega semantic-task apply --json`: confirmed WRITE classification, required write-mode option, and the task-list ID source.
- `git diff --check`: passed.

Dependencies were installed from the existing lockfile. No version, CI, or release settings changed. Live saved-result application and remote CI have not been run.

## Successful application semantics

The requester clarified that successful manual application sets `applied=true` even with no Resource metadata changes. The SDK preserves this server-owned result, the original `apply_mode=dry_run`, and the no-change application details. Repeated application cannot write again; choosing another strategy requires a new task. The HTTP response shape is unchanged.

The guide regression first failed against the previous no-change guidance. After updating the guide and documentation, the four affected test files passed all 111 tests, lint/typecheck passed, the full suite again passed 1508 tests with one existing optional live skip, and the build passed. The built command group's `describe` output was also inspected for the clarified success and new-task guidance. No live backend was called.
