# Dependency audit remediation

## Intent

Eliminate the npm audit findings observed after installing the RC, without changing
the release version or Node installation floor. Remove the accidental self
dependency separately; it is already absent from the working tree.

## Scope and approach

- Remove unused `csv-parse`: no source, script, or test imports it. Correct the
  datasource spec's stale local CSV parser claim.
- Raise the declared compatible floors to `js-yaml ^4.3.2` and `undici ^8.10.2`,
  so fresh consumer resolutions cannot select the affected releases.
- Update compatible locked dependencies, including `nanoid`, `postcss`, and
  `source-map-js`. Audit the lockfile as well as the installed dependency tree.
- Upgrade Vitest to patched 4.x after the requester confirmed the major migration
  as Owner in this conversation on 2026-10-13.
- Latest tsup 8.5.1 still declares esbuild `^0.27.0`; no upstream compatible
  release exists. Use an explicit reviewed esbuild `^0.28.1` override across the
  development toolchain, then validate the tests, bundles, declarations, and
  packed installation. Remove the override once upstream supports the fix.

## Alternatives

`--no-audit` hides the report without fixing vulnerabilities. `npm audit fix
--force` can change major versions without a migration review. Neither is used.

## Verification

Run lint, unit tests, build, full and production-only audits, and a packed CLI
installation on Node 22.19.0. Verify a zero-finding audit against both the
lockfile and installed tree. No commit, tag, push, or publication is part of this task.

## Owner-approved migration

1. What: migrate `vitest ^3.0.0` to `^4.1.11` or a later patched 4.x release.
   This addresses the reported Vitest/mocker and Tinypool findings. Inspect the
   official Vitest 4 migration guide before changing pool or mocking behavior.
   Blast radius: development tests, setup hooks, mocks, and CI; the runtime
   dependency surface and Node floor stay unchanged. Rollback: restore the
   manifest and lockfile from the approved pre-migration commit and run `npm ci`.
2. What: use esbuild `^0.28.1` through an explicit development-toolchain override.
   Latest tsup 8.5.1 requires `^0.27.0`, so this knowingly exceeds its declared
   compatibility range. The Owner-approved major migration is verified through
   a clean install, lint, full tests, bundles, declarations, and packed CLI/SDK
   installation; this is bounded evidence rather than an upstream support claim.
   The lockfile resolves esbuild 0.28.2 and Vitest 4.1.11 with Vite 8.3.4.
   Blast radius: bundled JS, declarations, source maps, and release packaging.
   Rollback: restore the toolchain manifest/lockfile and rebuild from the
   approved pre-migration commit.

Acceptance gates: no audit findings in the locked or installed trees, unchanged
test assertions and counts, full suite/lint/build passing, and an installable packed SDK/CLI
on Node 22.19.0. Do not publish a new RC until its final diff is approved.

Sources: [CSV advisory](https://github.com/advisories/GHSA-8cw4-87c7-c6xx),
[Tinypool advisory](https://github.com/advisories/GHSA-85c8-ppgw-ccpr), and
[Vitest 4 migration guide](https://v4.vitest.dev/guide/migration.html), and
[esbuild 0.28.1 security fix](https://github.com/evanw/esbuild/releases/tag/v0.28.1). Installed and
candidate version constraints were checked with `npm view` and `npm ls`.
