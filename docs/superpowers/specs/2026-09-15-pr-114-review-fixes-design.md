# PR 114 review fixes

## Scope

Address the four defects found in review of the CLI P0 guardrails. The changes
preserve existing command names and SDK return types.

## Decisions

- Treat an object-type snapshot as unreadable unless every entry has both
  `data_source` (which may be `null`) and `data_properties` (which may be an
  empty array). A missing field cannot prove an absent binding or index.
- Keep every pre-push error except a non-gateway 404 intact. This preserves
  authorization diagnostics and the CLI's auth exit code while still making it
  clear that the upload was not sent.
- Validate public `BuildWaitOptions` before the first status request. Both
  numerical options must be finite, non-negative numbers; `timeoutMs: 0`
  retains its documented unlimited-wait meaning.
- Make the query-object-instance dry-run preview represent the direct MCP tool
  payload: it carries the user arguments unchanged and identifies the network
  through `x-kn-id`. The managed lifecycle context is intentionally absent
  because it is established through a handshake that dry-run does not perform.

## Verification

Add focused tests for incomplete pre- and post-push snapshots, preservation of
401/403 failures, invalid SDK wait options before network I/O, and the exact
dry-run request body. Run the focused tests, lint, the full unit suite, build,
and a whitespace diff check.
