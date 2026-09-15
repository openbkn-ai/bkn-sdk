# Read retry design

## Intent

Fulfil the reliability contract for transient failures without replaying a
platform mutation. A failed read should recover from a short network outage or
a 5xx response automatically; a create, update, delete, execute, or managed
semantic search must still surface its first failure.

## Approach

- `request()` treats `GET` as retryable by default.
- A POST read must opt in with an internal `retryable` flag at its API call
  site. This is used only for the existing query-over-POST ontology endpoints.
- A retryable logical send makes at most three attempts. It retries rejected
  transport promises and HTTP 5xx responses, using 100 ms then 200 ms delays.
- 4xx responses, timeout/abort errors, and successful responses are returned
  immediately. The request timeout remains a single budget for all attempts.
- The existing one-time 401 refresh remains separate: each authenticated send
  gets the same bounded read retry policy, while a 401 retry of a write stays
  limited to the existing authentication-recovery case.

## Rejected alternatives

- Retrying every POST would replay writes when a response was lost.
- Inferring read semantics from a URL would couple transport policy to backend
  route naming and would be unsafe for future routes.
- Retrying 4xx statuses would hide invalid input, authorization failures, and
  rate-limit policy from callers.

## Affected layers

The implementation stays in `api/http.ts`; the ontology API marks its four
known body-carrying read endpoints. Unit tests stub `fetch` and assert attempt
counts, retry boundaries, and request preservation.
