# Managed lifecycle conversation mode

## Intent

Restore managed semantic search and Context Loader business-tool calls against
the current Foundry lifecycle contract. Preserve the handshake error when the
SDK cannot open an interaction so callers see the actual failure.

## Design

Retain the catalog-based `conversation_mode` capability detection added by
#64. For managed-v2 starts, always send the stable `agent_name`, including when
joining a conversation. When the catalog requires `conversation_mode`, use
`new` without `conversation_id` when minting a conversation and `continue` with
`conversation_id` when joining one.

Once the lifecycle catalog positively advertises a managed contract, an
interaction handshake failure is authoritative. `bknContextFor` will propagate
it instead of issuing the business request without `bkn_context`.

## Tests

- Assert the exact managed-v2 start arguments for `new`.
- Assert the exact managed-v2 start arguments for `continue`.
- Assert that a handshake error is surfaced and semantic search is not sent.

## Non-goals

- No changes to the lifecycle capability detection added by #64.
- No changes to session caching, stale-session retries, or release behavior.
- No compatibility behavior for deployment shapes not in the supported
  contract.
