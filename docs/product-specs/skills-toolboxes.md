# Skills & toolboxes

## Goal

Manage the skill registry and the Toolbox execution surface that agents call. The CLI separates temporary sandbox work from persistent capabilities so a command name states what is being operated.

## User-visible behavior

- `openbkn skill list` — skills / marketplace (limit 30); progressive read of a skill's manifest.
- `openbkn skill install <id>` — download + install a skill.
- `openbkn skill publish <path>` — register a skill.
- `openbkn sandbox run` — run temporary Python code without registering it; `sandbox generate` and `sandbox prompt` use the platform model to draft code or read its generation template.
- `openbkn function` — create, list, manage, and execute registered Function Tools in a Toolbox.
- `openbkn api` — import, list, manage, and execute registered OpenAPI Tools in a Toolbox.
- `openbkn toolbox` — create, publish, and move Toolbox containers.
- `openbkn tool` — advanced, type-neutral Toolbox/Tool access retained for existing automation.

## SDK touchpoints

- `resources/skills.ts`, `resources/toolboxes.ts`, `resources/functions.ts` over
  `api/skills.ts`, `api/toolboxes.ts`, `api/functions.ts`.
- The typed CLI groups reuse `client.toolboxes`; they do not create a parallel persisted-tool resource API.

## Edge cases

- Skill install is progressive — fetch manifest before pulling the full package.
- Tool calls are **not idempotent** — never auto-retry.
- Validate OpenAPI imports at the boundary; reject malformed specs with a clear message.
- Function generation is a model invocation, not a persisted component. The SDK supports its JSON response only; callers needing `stream: true` use the raw `call` API because the response is SSE.
- `function` now means a registered Function Tool. Use `sandbox` for a one-off run, schema inference, dependencies, templates, and AI generation.
