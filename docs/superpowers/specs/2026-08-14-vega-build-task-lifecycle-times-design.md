# Vega BuildTask lifecycle times

## Intent

Align the SDK's BuildTask contract with the Vega lifecycle timestamp model in
openbkn-ai/bkn-foundry#806.

## Scope

- Replace the BuildTask `update_time` response field with `start_time`,
  `finish_time`, and `last_progress_time`.
- Replace the BuildTask list sort values with `create_time`, `start_time`,
  `finish_time`, and `last_progress_time`.
- Update the Vega dataset build-list CLI help and SDK product specification.
- Keep Discover and Semantic Understanding tasks out of scope: the SDK does
  not currently expose clients for those endpoints.

## Design

The API-layer Zod schemas remain the SDK contract source of truth. Both the
single-task and list-summary schemas expose optional lifecycle timestamps,
because create, list, and status endpoints can return different response
subsets and the backend omits unset timestamps.

`BuildTaskSort` is the shared validator used by the API options and CLI. Its
enum replaces `update_time` directly; there is no compatibility alias because
the backend contract is intentionally breaking. Tests cover response parsing,
query serialization, and CLI validation.

## Rejected alternatives

- Retain `update_time` as a deprecated SDK alias: it would advertise a query
  value rejected by the backend and obscure the distinct lifecycle semantics.
- Add Discover or Semantic Understanding clients in this change: that expands
  the SDK surface beyond adapting the already exposed BuildTask contract.
