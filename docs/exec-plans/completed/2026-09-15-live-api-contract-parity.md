# Live API contract parity

- [x] Add focused regression tests for action query override/path and KN detail options.
- [x] Add focused regression tests for lossless Skill list/detail reads.
- [x] Add MCP and CLI tests for object-shaped schema scope and legacy `--scope` mapping.
- [x] Implement the four named read-path adjustments in the existing layers.
- [x] Update knowledge-network, skill, and CLI reference docs.
- [x] Run focused tests, `npm run lint`, `npm test`, and `npm run build`; inspect the scoped diff.

Verification: 97 focused tests passed; the clean worktree suite passed 708 tests with one
environment-gated live rubric test skipped. The TLS unit test needs local loopback
listen permission and passed with that permission. The built SDK was read-only
checked against the 2026-09-15 deployment: Skill `update_time` remained exactly
`1789268781834562743` on SDK and CLI list/detail reads; action query advanced
past the missing-override 400 and matched the same downstream
`OntologyQuery.Proxy.Unavailable` 503 returned by a direct documented request;
KN full and summary detail reads succeeded, with summary smaller than full.
The deployed MCP catalog advertises an object `search_scope`. A valid object
request returned the same `agentRetrieval.ServiceUnavailable.CommonExternalServerError`
503 over REST and MCP, so live Schema search remains unavailable while that
dependent service fails. The only newly created Trace test conversation was
finished and closed.
