# Tech stack decisions

Locked choices for `@openbkn/bkn-sdk`. The two legacy repos diverged on several
tools; this records what the rewrite picks and why. Update here if a choice changes.

## Locked

| Concern | Choice | Why |
| ------- | ------ | --- |
| Language | TypeScript (ESM), Node ≥ 22.19.0 | The floor is what the code needs, not the newest runtime that meets it: lossless BIGINT parsing uses native JSON source-text access, and `undici` wants Node ≥22.19, so 22.19.0 is where both are satisfied. A higher floor was tried and reverted — npm resolves past a version whose `engines` the caller cannot meet, so declaring 24.19.0 did not prompt anyone to upgrade, it silently served them the previous release instead. Security-lifecycle preferences belong in guidance, not in a field that decides installability. |
| CLI framework | **commander** | Mature, 0 runtime deps, clean command tree, biggest ecosystem. Needs a custom grouped-help renderer (see below) |
| Interactive prompts | **@clack/prompts** | Pretty modern prompts for login and confirmations. Replaces `ink`/`inquirer` — lighter, no TUI |
| Pretty output | **chalk** + **cli-table3** | Color + aligned tables for human output |
| Validation | **zod** | Parse at IO boundaries (argv, HTTP responses); already used by the legacy SDK |
| HTTP | native `fetch` | No axios/node-fetch dep; available throughout the supported Node ≥22.19 range |
| Build | **tsup** | Dual output (library + `openbkn` bin) in one config; from the legacy operator CLI. Replaces the legacy SDK's hand-rolled `tsc` + `cp` script |
| Test | **vitest** | One runner, UT + coverage; from the legacy operator CLI. Replaces the legacy SDK's `node:test` + tsx |
| Lint + format | **Biome** | Single fast tool, near-zero config; neither legacy repo had a real linter, so no migration cost |
| Package manager | **npm**, single package | Simplest; matches the agreed Library+CLI single-package shape (monorepo rejected) |
| Publish | npm scope `@openbkn` | Per project requirement |

## Grouped help renderer

The legacy help is **not** commander's default flat list — it groups
commands under task-shaped section headers (`SIGN IN & SETTINGS`,
`DATA & KNOWLEDGE`, `MODELS`, `TOOLS & SKILLS`, `TRACING`,
`ADMINISTRATION`, `RAW API`) and adds `USAGE` / `FLAGS` /
`ENVIRONMENT` / `EXAMPLES` / `LEARN MORE` blocks. To keep `openbkn --help` equivalent,
override commander's help via `Command.configureHelp()` / a custom `formatHelp`:

- Tag each command with a group (e.g. `cmd.addHelpText` or a `group` attribute read by the formatter).
- Render section headers in registration order; the root also carries a `guide()` block (FIRST STEPS / COMMON TASKS / GOOD TO KNOW / NOT HERE YET) rendered between the command list and FLAGS.
- **Applies at every level**: the same formatter groups a command's own subcommands too (e.g. `openbkn bkn --help` → LIFECYCLE / SCHEMA / …), matching legacy depth-1 group help.
- Keep `openbkn help all` = full per-action signature dump (migration fallback).

This is one small shared formatter module, not per-command help strings. It applies at every depth of the command tree.

## Rejected / out of scope

- **ink / react** — dropped. No complex chat TUI is needed; `model llm chat` streams plain text. Cuts a heavy dep tree and keeps the SDK light to import.
- **inquirer** — `@clack/prompts` is lighter and prettier for the few interactive flows.
- **yargs** — would minimize user-side migration but forces rewriting the admin tree; commander chosen instead.
- **citty / cac** — leaner/more-modern CLI parsers, but smaller ecosystems and more migration risk; commander's maturity wins here.
- **oclif** — plugin framework built for large multi-CLI suites; overkill for one lean single-package SDK.
- **pnpm / workspace monorepo** — single package is enough; no multi-package split.
- **ESLint + Prettier** — heavier config than Biome with no existing setup to preserve.
- **Python SDK** — dropped entirely in this rewrite.
- **axios / node-fetch** — native `fetch` covers it.

## Divergence reference (legacy)

| Tool | legacy SDK | legacy operator CLI |
| ---- | ---------- | ------------------- |
| CLI | yargs 18 + ink + react | commander 13 |
| Build | tsc + cp | tsup / esbuild |
| Test | node:test + tsx | vitest |
| Validation | zod 4 | — |
| Pkg manager | npm | pnpm 9 |
| Node | ≥22 | ≥18 |
