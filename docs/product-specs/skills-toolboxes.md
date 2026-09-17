# Skills & toolboxes

## Goal

Manage the skill registry and the toolbox/tool execution surface (the "execution factory") that agents call.

## User-visible behavior

- `openbkn skill list` — skills / marketplace (limit 30); progressive read of a skill's manifest.
- `openbkn skill install <id>` — download + install a skill.
- `openbkn skill publish <path>` — register a skill.
- `openbkn mcp list|get|tools` — inspect registered MCP Servers and their advertised tool schemas without invoking them.
- `openbkn tool list` — tools in a toolbox; `openbkn tool call <id> ...` — invoke a tool.
- Toolbox lifecycle: create, upload OpenAPI tools, publish, enable/disable.

## SDK touchpoints

- `resources/skills.ts`, `resources/mcp.ts`, `resources/toolboxes.ts` over `api/skills.ts`, `api/mcp.ts`, `api/toolboxes.ts`.

## Edge cases

- Skill install is progressive — fetch manifest before pulling the full package.
- Tool calls are **not idempotent** — never auto-retry.
- Validate OpenAPI uploads at the boundary; reject malformed specs with a clear message.
- List endpoints page by `page` (1-based) + `page_size` (1–100); there is no `offset` or `keyword`. The CLI refuses `--limit` above 100 and `--offset`; `toolbox list --keyword` survives as an alias of `--name`.
- Toolbox status is `unpublish` / `published` / `offline` (no `draft`): `toolbox unpublish` sends `offline`. Skill `set-status` accepts only `published` / `offline`.
- `*_time` fields are int64 nanoseconds — skill, toolbox and tool reads parse them as bigint so they stay exact.
- `tool execute` / `tool debug` wait `--timeout` plus a margin (the sandbox maximum when omitted), not the 30s client default.
- `toolbox import --mode create|upsert`; omitted, the service applies `create` (fail if the component exists).
- MCP Market, registration, lifecycle changes, and proxy invocation are separate from the read-only MCP discovery surface.
