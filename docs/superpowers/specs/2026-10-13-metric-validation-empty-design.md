# Legacy empty Metric validation response

The requester approved a narrow compatibility fix after the 23 environment returned
HTTP 200 with an empty body for a valid existing Metric definition.

Normalize only an undefined successful response from the shared request helper to
`{valid: true}` inside `validateMetric`. The helper produces undefined for empty
successful bodies, including HTTP 200 and 204. JSON null, missing or wrongly typed
`valid`, and malformed detail remain invalid; HTTP failures still throw.

Keep the canonical route, CLI result printing and negative-result exit status.
Changing shared HTTP parsing would affect unrelated commands, and requiring a
backend deployment would leave the existing environment broken, so compatibility
belongs at this specific API boundary.

Add SDK and CLI regressions for empty successful bodies, retain negative-result and
HTTP-error coverage, and explicitly reject JSON null. Update CLI, README and Skill
guidance. Verify lint, full unit tests, and build. On 23, fetch the existing
`m_order_cnt` definition from `ecommerce_ops_bkn_zh_attrs_import`, submit its creation
fields under a unique temporary name to validation only, and require SDK success
and CLI exit 0. Change the copied scope to a nonexistent ID to require failure.
Read metrics before and after to confirm nothing was persisted.
