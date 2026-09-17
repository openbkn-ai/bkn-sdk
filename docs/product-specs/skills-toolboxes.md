# Skills & toolboxes

## Goal

Manage the skill registry and the Toolbox execution surface that agents call. The CLI separates temporary sandbox work from persistent capabilities so a command name states what is being operated.

## User-visible behavior

- `openbkn skill list` — skills / marketplace (limit 30); progressive read of a skill's manifest.
- `openbkn skill install <id>` — download + install a skill.
- `openbkn skill publish <path>` — register a skill.
- `openbkn mcp list|get|tools` — inspect registered MCP Servers and their advertised tool schemas without invoking them.
- `openbkn sandbox run` — run temporary Python code without registering it; `sandbox generate` and `sandbox prompt` use the platform model to draft code or read its generation template.
- `openbkn function` — create, list, manage, and execute registered Function Tools in a Toolbox.
- `openbkn api` — import, list, manage, and execute registered OpenAPI Tools in a Toolbox.
- `openbkn toolbox` — create, publish, and move Toolbox containers.
- `openbkn tool` — advanced, type-neutral Toolbox/Tool access retained for existing automation.

## SDK touchpoints

- `resources/skills.ts`, `resources/mcp.ts`, `resources/toolboxes.ts`, `resources/functions.ts` over
  `api/skills.ts`, `api/mcp.ts`, `api/toolboxes.ts`, `api/functions.ts`.
- The typed CLI groups reuse `client.toolboxes`; they do not create a parallel persisted-tool resource API.

## Edge cases

- Skill install is progressive — fetch manifest before pulling the full package.
- Tool calls are **not idempotent** — never auto-retry.
- `execute` requires the tool to be enabled **and** its toolbox published; an unpublished or offline box answers 400 `ToolNotAvailable`. `debug` works before either gate. Order: create box → import/create tool → enable → publish → execute.
- `execute` and `debug` (on `tool`, `function`, and `api`) exit non-zero when the platform reports the tool call itself failed, even though the HTTP response is 200.
- Toolbox proxy and debug calls to function tools are cut by the platform at ~30 s regardless of `timeout`, answering 200 with `result: null`; long jobs belong on `sandbox run`.
- Typed `function list` / `api list` do not check the box's metadata type; `--toolbox` must name a box of the matching type.
- Validate OpenAPI imports at the boundary; reject malformed specs with a clear message.
- List endpoints page by `page` (1-based) + `page_size` (1–100); there is no `offset` or `keyword`. The CLI refuses `--limit` above 100 and `--offset`; `toolbox list --keyword` survives as an alias of `--name`.
- Toolbox status is `unpublish` / `published` / `offline` (no `draft`): `toolbox unpublish` sends `offline`. Skill `set-status` accepts only `published` / `offline`.
- `*_time` fields are int64 nanoseconds — skill, toolbox and tool reads parse them as bigint so they stay exact.
- `tool execute` / `tool debug` (and the typed `function` / `api` equivalents) wait `--timeout` plus a margin (the sandbox maximum when omitted), not the 30s client default.
- `toolbox import --mode create|upsert`; omitted, the service applies `create` (fail if the component exists).
- MCP Market, registration, lifecycle changes, and proxy invocation are separate from the read-only MCP discovery surface.
- Function generation is a model invocation, not a persisted component. The SDK and CLI support its JSON response only; `stream: true` answers SSE, which no CLI command (including `openbkn call`, which buffers the response) streams yet.
- `sandbox generate` waits up to the gateway's ~300 s limit by default rather than the 30 s client default; `--timeout <s>` (CLI) or `timeoutMs` (SDK) overrides it.
- `function` now means a registered Function Tool. Use `sandbox` for a one-off run, schema inference, dependencies, templates, and AI generation.
