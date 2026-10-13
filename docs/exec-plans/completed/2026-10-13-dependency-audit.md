# Dependency audit remediation

Design: [dependency audit remediation](../../superpowers/specs/2026-10-13-dependency-audit-design.md).

1. Record the initial audit and inspect imports and dependency paths.
2. Remove the unused CSV dependency; raise compatible runtime dependency floors.
3. Refresh compatible locked packages, then implement the Owner-approved Vitest
   migration and reviewed esbuild override.
4. Run lint, unit tests, build, audits, and a packed install on the Node floor.
5. Present the final diff and compatibility limits for review; do not publish.

## Compatible remediation completed

- Removed unused `csv-parse` and corrected the outdated CSV parser claim.
- Updated compatible dependency floors and lockfile versions; preserved the
  manifest's Node floor and the release version.
- `npm run lint`, `npm run check:version`, `npm test` (1260 passed, one optional
  live test skipped), and `npm run build` passed.
- Full audit fell from ten to four entries after self-dependency cleanup:
  one low, one moderate, two critical, all development dependencies.
- Production-only audit reports zero vulnerabilities. `npm pack` followed by
  a temporary packed install and CLI execution on Node 22.19.0 passed, and
  the packed installation's production audit also reports zero vulnerabilities.
- The requester subsequently confirmed the major migrations as Owner. No commit,
  tag, push, or publication performed.

## Owner-approved migration

- Upgraded Vitest to 4.1.11; its pool no longer depends on Tinypool.
- Added esbuild `^0.28.1` override, resolving 0.28.2. tsup still declares 0.27
  compatibility; validated use of this override is documented as maintenance debt.
- Reset both OAuth module mocks before each auth-login preflight test. Vitest 4
  no longer clears these automocks through `restoreAllMocks`; assertions remain
  unchanged, and the previously failing device-code case now passes.
- Full audit reports zero vulnerabilities after migration.
- On Node 22.19.0, a clean `npm ci --no-audit --no-fund`, `npm run lint`,
  `npm test` (1260 passed, one optional live test skipped), and `npm run build`
  all passed. The focused eight-case auth-login suite also passed after the
  mock reset change.
- Repacked the final build and installed it into a temporary project on Node
  22.19.0. The `openbkn` executable, ESM SDK import, unchanged declared Node floor,
  and installed dependency audit (zero findings) were verified.
