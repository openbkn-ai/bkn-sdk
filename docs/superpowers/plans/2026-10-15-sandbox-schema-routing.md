# Sandbox schema fix execution plan

- [x] Reproduce the sandbox route 404 and nullable schema lists on 23.
- [x] Keep one BKN_BASE_URL and implement bounded authenticated internal schema reads.
- [x] Rebase SDK fix onto main 2148c8e, preserving #182 and #183.
- [x] Isolate companion backend changes on main 8fe908cae in a separate worktree.
- [x] Include the Object Metric V1 catalogue route and pagination on the new baseline.
- [x] Run focused regressions and repository quality gates.

## Verification (2026-10-16)

SDK: Ruff check/format, mypy, pytest (490 passed, 32 live tests skipped),
npm run lint, npm test (1297 passed, one live test skipped). Rebase retained
all upstream V1 metric and generated capability-client tests.

Backend: GOTOOLCHAIN=auto go test -race ./server/app ./server/driveradapters
./server/drivenadapters passed. Cases cover OAuth/AppKey identity, spoofed
headers, read-only scope, branch and metric pagination, raw/bigint preservation,
permission failures, cancellation, redirects and the response-size limit.
OpenAPI documents four sandbox-only GET aliases.

The original feature branch and pre-rebase stash were retained as backups. No
existing release tag was modified. No persistent 23 deployment was performed;
the new backend default path still requires Owner-approved rollout validation.

A real-client loopback HTTP check also passed: TestSchemaSandboxWithPythonOSDK
runs the rebased Python OSDK against the authenticated Go alias router, with
four deterministic schema responses, null arrays and a published versioned metric.
This is local integration evidence, not a 23 rollout acceptance result.

Tracking: SDK #185 and companion Foundry #2188. Both PRs are requested directly
by the user and remain drafts pending review and deployed-service validation.
