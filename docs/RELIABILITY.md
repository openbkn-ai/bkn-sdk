# Reliability

Runtime expectations for the SDK and CLI as a client of the BKN backend.

## Timeouts

- Every `fetch` in `api/` sets an explicit timeout (via `AbortController`); no unbounded requests.
- Long operations (uploads, dataflow runs) use a longer, named timeout — not the default.

## Retries

- Retry **only idempotent** reads (GET, list, query) on transient network/5xx errors; small bounded backoff.
- Never auto-retry writes (create/update/delete, chat turns) — surface the error instead.

## Idempotency

- Push/pull and import operations should be safe to re-run; document any non-idempotent command in its product spec.

## Errors & exit codes

- `api/` maps HTTP/network failures to typed errors; `utils/errors` maps those to user messages + non-zero exit codes.
- Auth failures (401/403) tell the user to re-login, not just "request failed".

## Observability

- `--json` output is stable and scriptable.
- Trace/evidence inspection is a first-class domain: [product-specs/bkn-trace.md](product-specs/bkn-trace.md).
