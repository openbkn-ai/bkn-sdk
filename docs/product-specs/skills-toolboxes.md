# Skills & toolboxes

## Goal

Manage the skill registry and the toolbox/tool execution surface (the "execution factory") that agents call.

## User-visible behavior

- `openbkn skill list` — skills / marketplace (limit 30); progressive read of a skill's manifest.
- `openbkn skill install <id>` — download + install a skill.
- `openbkn skill publish <path>` — register a skill.
- `openbkn function generate <type>` — generate Python handler code or parameter
  metadata with the platform default LLM; `function prompt <type>` reads the
  corresponding prompt template.
- `openbkn tool list` — tools in a toolbox; `openbkn tool call <id> ...` — invoke a tool.
- Toolbox lifecycle: create, upload OpenAPI tools, publish, enable/disable.

## SDK touchpoints

- `resources/skills.ts`, `resources/toolboxes.ts`, `resources/functions.ts` over
  `api/skills.ts`, `api/toolboxes.ts`, `api/functions.ts`.

## Edge cases

- Skill install is progressive — fetch manifest before pulling the full package.
- Tool calls are **not idempotent** — never auto-retry.
- Validate OpenAPI uploads at the boundary; reject malformed specs with a clear message.
- Function generation is a model invocation, not a persisted component. The SDK
  supports its JSON response only; callers needing `stream: true` use the raw
  `call` API because the response is SSE.
