# CLI reliability fixes

## Scope

The CLI improvement review identified three reproducible defects. The requester
approved addressing these first. Preserve the existing worktree changes and fix
the defects in their owning layers without changing public flags or API shapes.

## Decisions

- **Trace filters:** use `optsWithGlobals()` in `trace search`. Commander consumes
  the conversation/interaction flags as global options even when they follow the
  subcommand. Pass explicit flags into the existing typed query serializer. Do not
  infer search filters from environment variables or the remembered conversation.
- **401 recovery:** rebuild headers inside each `request()` send attempt, so the
  one authorized retry reads the refreshed token. Preserve request body, custom
  headers, timeout, and the existing one-refresh limit. A failed refresh or a
  second 401 still fails; explicit tokens have no refresh credentials. Upstream
  #110 landed this behavior before this branch was prepared; this PR adds only
  the BKN_TOKEN source hint and focused request-preservation coverage.
- **Build waiting:** compare the current time with the deadline, and sleep for
  the smaller of the poll interval and remaining time. Read status after the final
  shortened sleep before deciding whether the task is still running. Keep
  `timeoutMs: 0` unlimited and retain the last task in `WaitTimeoutError`.
  In-flight status reads retain the existing HTTP timeout; this change bounds
  polling waits and does not cancel the build or add transport cancellation.

Direct fixes in the existing layers are preferred over introducing a common
retry/polling framework. Renaming Trace flags would break scripts; changing the
global Commander parser would affect unrelated commands. Neither is needed.

## Acceptance and verification

- Run the complete CLI command tree with either or both Trace ID filters before
  and after `trace search`; assert the actual URL query parameters.
- Mock the OAuth endpoint and business endpoint; accept the retry only when its
  Authorization header contains the new token. Verify failed refresh and second
  401 do not trigger another retry.
- Use fake time to verify a 1-second timeout does not settle at 0 or 999 ms, polls
  at the final boundary, and returns a task that completed during the final wait.
- Keep immediate terminal states, unlimited waits, task/error output, and
  unrelated filters covered. Run focused tests before and after the fixes, then
  lint, the full unit suite, and build.

Mocked regressions cover these defects. Isolated BKN import validation was
performed separately for the P0 guardrails on the test environment.
