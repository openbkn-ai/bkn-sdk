# Reliability

Runtime expectations for the SDK and CLI as a client of the BKN backend.

## Timeouts

- Every `fetch` in `api/` sets an explicit timeout (via `AbortController`); no unbounded requests.
- Long operations (uploads) use a longer, named timeout — not the default.

## Retries

- The SDK does not retry transient network/5xx failures today; the error surfaces to the caller.
  Transport retry is designed separately (MCP reads, 429/`Retry-After`, a `--no-retry` switch) and
  must stay limited to idempotent reads.
- Never auto-retry writes (create/update/delete, chat turns) — surface the error instead.

## Idempotency

- Push/pull and import operations should be safe to re-run; document any non-idempotent command in its product spec.

## Errors & exit codes

- `api/` maps HTTP/network failures to typed errors; `utils/errors` maps those to user messages + non-zero exit codes.
- Auth failures (401/403) tell the user to re-login, not just "request failed".
- Stored refresh credentials allow one refresh and one retry after a 401. The retry
  rebuilds Authorization from the refreshed token and preserves the request body
  and custom headers. A failed refresh or second 401 remains an error; explicit
  tokens without refresh credentials are not refreshed.

## Observability

- `--json` output is stable and scriptable.
- Trace/evidence inspection is a first-class domain: [product-specs/bkn-trace.md](product-specs/bkn-trace.md).
