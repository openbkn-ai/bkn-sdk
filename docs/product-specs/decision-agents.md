# Decision agents

## Goal

Create and operate decision agents and hold conversations with them — the core "talk to your knowledge" surface.

## User-visible behavior

- `openbkn agent list` — agents (templates, mine, shared); default limit 30.
- `openbkn agent get <id>` — agent detail.
- `openbkn agent chat <id>` — chat with plain streamed text (no TUI) or one-shot with a message arg.
- `openbkn agent sessions <id>` / `openbkn agent history <id>` — session list / past turns (limit 30).
- `openbkn agent members <id>` — membership management.

## SDK touchpoints

- `resources/agents.ts`, `resources/conversations.ts` over `api/agent-list.ts`, `api/agent-chat.ts`, `api/conversations.ts`, `api/agent-observability.ts`.
- Streaming chat responses surface incrementally to the CLI; SDK exposes an async iterator.

## Edge cases

- Long-running/streamed turns: respect timeouts; never auto-retry a chat turn (non-idempotent).
- Permission errors on shared agents → actionable 403 message.
- `--json` for chat returns structured turns, not rendered markdown.
