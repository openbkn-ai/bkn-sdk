# Skills & toolboxes

## Goal

Manage the skill registry and the toolbox/tool execution surface (the "execution factory") that agents call.

## User-visible behavior

- `openbkn skill list` — skills / marketplace (limit 30); progressive read of a skill's manifest.
- `openbkn skill install <id>` — download + install a skill.
- `openbkn skill publish <path>` — register a skill.
- `openbkn tool list` — tools in a toolbox; `openbkn tool call <id> ...` — invoke a tool.
- Toolbox lifecycle: create, upload OpenAPI tools, publish, enable/disable.

## SDK touchpoints

- `resources/skills.ts`, `resources/toolboxes.ts` over `api/skills.ts`, `api/toolboxes.ts`.

## Edge cases

- Skill install is progressive — fetch manifest before pulling the full package.
- Tool calls are **not idempotent** — never auto-retry.
- Validate OpenAPI uploads at the boundary; reject malformed specs with a clear message.
