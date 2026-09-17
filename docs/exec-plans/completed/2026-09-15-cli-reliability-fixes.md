# CLI reliability fixes

Design: [CLI reliability fixes](../../superpowers/specs/2026-09-15-cli-reliability-fixes-design.md).

## Tasks

- [x] Review the improvement report, repository conventions, and existing changes.
- [x] Record the approved scope, alternatives, and acceptance criteria.
- [x] Add focused regression tests and observe the reported failures.
- [x] Fix Trace flag forwarding and the polling deadline; integrate the upstream
  401 retry fix from #110 while retaining the BKN_TOKEN source hints.
- [x] Update behavior documentation and the quality scorecard.
- [x] Run focused tests, lint, the full unit suite, and build; review the diff.

## Boundaries

The existing authentication guidance and build-progress work stays in place.
Remaining P0 improvements (push integrity, BKN table diagnostics, query input
validation) follow separately; this batch only fixes the three reproduced defects.

## Verification

- `npx vitest run test/unit/http.test.ts test/unit/trace-command.test.ts test/unit/build-wait.test.ts`:
  focused regressions passed. Upstream #110 independently supplied the header
  rebuild and proactive token renewal before this PR was branched from `main`.
- `npm run lint`, `npm test` (777 passed, 1 existing live test skipped), and
  `npm run build`: passed on the PR branch based on the latest `main`.
- `node dist/cli.js describe trace search --json`: verified both filter flags and
  the READ classification remain visible.
- `git diff --check`: passed.

The Trace filter and BuildTask wait checks used local mocks. Live backend filter
behavior and in-flight request cancellation were not tested; the latter is outside
this batch's scope.
