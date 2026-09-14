# Reliability

Runtime expectations for the SDK and CLI as a client of the BKN backend.

## Timeouts

- Every `fetch` in `api/` sets an explicit timeout (via `AbortController`); no unbounded requests.
- Long operations (uploads) use a longer, named timeout — not the default.

## Retries

- Retry **only idempotent** reads (GET, list, query) on transient network/5xx errors; small bounded backoff. Implemented in `src/api/retry.ts`: a read is a GET/HEAD/OPTIONS, a POST carrying `X-HTTP-Method-Override: GET`, a request passed `idempotent: true` (search, metric query, dry-run), or an MCP call to a tool on its read-only list. Retried: refused/reset/timed-out connection, `EAI_AGAIN`, 429, 502, 503, 504 — 3 times from 1s, honouring `Retry-After`, within the request's own timeout. `--no-retry` turns it off.
- Never auto-retry writes (create/update/delete, chat turns) — surface the error instead.

## Idempotency

- Push/pull and import operations should be safe to re-run; document any non-idempotent command in its product spec.

## Errors & exit codes

- `api/` maps HTTP/network failures to typed errors; `utils/errors` maps those to user messages + non-zero exit codes.
- Auth failures (401/403) tell the user to re-login, not just "request failed".

## Observability

- `--json` output is stable and scriptable.
- Trace/evidence inspection is a first-class domain: [product-specs/bkn-trace.md](product-specs/bkn-trace.md).
