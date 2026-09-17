# PR 114 review fixes

## Scope

Address the four defects found in review of the CLI P0 guardrails. The changes
preserve existing command names and SDK return types.

## Decisions

- Treat an object-type snapshot as unreadable unless every entry has
  `data_source` (which may be `null`). A missing `data_properties` key is an
  empty list: bkn-backend serializes that field with `omitempty`, so an object
  type without data properties omits it. A present non-array value is refused.
- A 401/403 on the pre-push read warns `integrity not verified: <reason>` and
  the upload proceeds (superseding the earlier decision to abort). A non-gateway
  404 is a new network; every other pre-push error still aborts before upload.
- Validate public `BuildWaitOptions` before the first status request. Both
  numerical options must be finite, non-negative numbers; `timeoutMs: 0`
  retains its documented unlimited-wait meaning.
- Make the query-object-instance dry-run preview represent the direct MCP tool
  payload: it carries the user arguments unchanged and identifies the network
  through `x-kn-id`. The managed lifecycle context is intentionally absent
  because it is established through a handshake that dry-run does not perform.

## Verification

Add focused tests for incomplete pre- and post-push snapshots, preservation of
401/403 warnings that still upload, omitted `data_properties`, invalid SDK wait options before network I/O, and the exact
dry-run request body. Run the focused tests, lint, the full unit suite, build,
and a whitespace diff check.
