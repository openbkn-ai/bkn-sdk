# BKN CLI P0 integrity work

Design: [BKN CLI P0 integrity checks](../../superpowers/specs/2026-09-15-bkn-p0-integrity-design.md).

## Steps

- [x] Confirm the branch-scoped platform object-type list carries full definitions for visible objects.
- [x] Add regression tests for push binding/operator loss and unreadable checks.
- [x] Implement the CLI push integrity read/compare/report path.
- [x] Integrate P0-2 and P0-3 validation changes from the independent workstreams.
- [x] Document behavior and verification gaps; run focused and full checks.
- [x] Present the full working-tree diff for review and validate an isolated import.

## Verification and limits

- Focused P0 tests: 64 passed (`push-integrity`, `push-integrity-dry-run`,
  `bkn-validate`, `query-object-instance`).
- `npm run lint`: passed; `npm run build`: passed with declarations.
- `npm test`: 777 passed, 1 existing live test skipped on the PR branch. The default sandbox
  blocks the TLS test's localhost listener (`EPERM`); a read-only test run with
  local listening enabled passed the entire suite.
- `git diff --check`: passed.
- An isolated network was pushed twice, then pulled and validated on
  14.103.77.23. The visible object-type bindings and operators survived both
  imports without false warnings. The after-push read can still fail after the
  write succeeded; the CLI reports that the comparison was not verified.
- The before/after list is filtered by `view_detail`; hidden object types are
  outside the comparison. `--dry-run` previews the upload POST without the
  integrity reads.
- Property membership in `query_object_instance.properties` cannot be decided
  without an object-type schema. The independent CLI invocation has no such
  prior response or cache; no implicit extra request was added.
