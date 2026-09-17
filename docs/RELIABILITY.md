# Reliability

Runtime expectations for the SDK and CLI as a client of the BKN backend.

## Timeouts

- Every `fetch` in `api/` sets an explicit timeout (via `AbortController`); no unbounded requests.
- Long operations (uploads) use a longer, named timeout — not the default.

## Retries

- Retry lives in `api/tls.ts` `tlsFetch`, which every outbound request passes through;
  up to 3 retries after 0.5 s / 1 s / 2 s.
- A connection that was never made (`ECONNREFUSED`, `EHOSTUNREACH`, `ENETUNREACH`,
  `EAI_AGAIN`, `UND_ERR_CONNECT_TIMEOUT`) is retried for any method: the request
  reached no server. That covers writes and an MCP `tools/call` with a managed
  `bkn_context` — nothing was received, so no operation or receipt is duplicated.
- A dropped or timed-out connection (`ECONNRESET`, `EPIPE`, `ETIMEDOUT`,
  `UND_ERR_SOCKET`, `UND_ERR_CLOSED`) and HTTP 429/502/503 are retried only for
  GET/HEAD — a write may already have landed. A Retry-After up to 10 s lengthens the
  wait; a longer one returns the response at once. 429 on a write is not retried: a
  rate limiter in front of a gateway cannot prove the write was never forwarded.
- A backoff sleep ends when the caller's signal aborts, so a deadline (the 5 s version
  preflight, `request()`'s 30 s) bounds every attempt and wait together.
- Never retried: `ENOTFOUND`, TLS errors, 504, other statuses, caller aborts, stream
  bodies, dry runs. `ClientOptions.retry: false` / CLI `--no-retry` turn retry off —
  including `call`, `admin call` and `auth change-password`, which resolve their own
  context. The CLI prints one stderr line per retry. OAuth login and refresh keep the
  default (no notice, no opt-out); under the same rule a rotated refresh token is
  never spent twice.

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
