# Row-filter explanation fix plan

1. Correct user-response fixtures and add focused API/resource and CLI regressions.
   Run them against the original parser to demonstrate the failure.
2. Make the wire flag optional, validate its semantics against the requested
   subject with Zod, and normalize missing user values at the public boundary.
3. Run focused tests, lint/typecheck, full unit tests, and build. Update quality
   coverage notes and present the local diff. Live tests on environment 132 and
   installation of a released package remain a separate acceptance step.

## Verification completed

- Before the fix, focused tests failed in six cases, including omitted user flags
  in the SDK and CLI, post-conflict explanation, and inconsistent boolean flags.
- `npm test -- test/unit/row-filter.test.ts test/unit/row-filter-command.test.ts`:
  40 passed after the fix.
- `npm run lint`: passed, including typecheck.
- `npm test`: 1372 passed, one optional test skipped. The sandbox's first run
  blocked the TLS test's localhost listener; rerunning with localhost permission
  passed all 91 enabled test files.
- `npm run build` and `git diff --check`: passed.
- No live environment, backend state, package release, or GitHub writes performed.
