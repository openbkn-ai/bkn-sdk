# AGENTS.md

Entry point for AI agents (Claude Code / Codex / others) working in this repo.
Read this first, then load the rules under [`rules/`](rules/). Before working in any subdirectory, locate and read every `AGENTS.md` from the repository root through that target directory; rules in the more specific (deeper) file take precedence.

## Read before doing anything

| Topic | File |
| --- | --- |
| How we collaborate (humans + Agents) | [rules/WORKFLOW.md](rules/WORKFLOW.md) |
| Contribution guide (branches, commits, style) | [rules/CONTRIBUTING.md](rules/CONTRIBUTING.md) |
| Architecture & module boundaries | [rules/ARCHITECTURE.md](rules/ARCHITECTURE.md) |
| API / HTTP / error conventions | [rules/DEVELOPMENT.md](rules/DEVELOPMENT.md) |
| Testing conventions | [rules/TESTING.md](rules/TESTING.md) |
| Module owners (review routing) | [.github/CODEOWNERS](.github/CODEOWNERS) |
| Issue templates (bug / feature / task) | [.github/ISSUE_TEMPLATE/](.github/ISSUE_TEMPLATE/) |
| Pull request template | [.github/pull_request_template.md](.github/pull_request_template.md) |

## Hard rules for Agents

- **Review before external writes**: Unless the requester explicitly directs otherwise, after making and verifying code changes, present the working-tree diff for review first. Do **not** commit, push, create or update a PR, or post Issue/PR comments before the requester approves.
- **Language**: Communicate with users in Chinese by default. Use another language only when the requester explicitly asks for it or the artifact itself requires it.
- **Clarify material ambiguity**: Before editing, ask for direction when an ambiguity would materially change scope, behavior, risk, or the intended solution; otherwise proceed with a stated, reasonable assumption.
- **Bug regression coverage**: For bug fixes, add or update a focused regression test that demonstrates the reported failure whenever it is practical.
- **Verification handoff**: After implementing a change, report relevant edge cases and any remaining test-coverage gaps along with the commands run.
- **Issue / PR templates**: Before creating an Issue, select the matching template under [`.github/ISSUE_TEMPLATE/`](.github/ISSUE_TEMPLATE/) and preserve its structure when filling in all applicable sections. Before creating or updating a PR, read and fully complete [`.github/pull_request_template.md`](.github/pull_request_template.md). Do not delete required sections; mark non-applicable items explicitly with a brief reason.
- **Only pick up Issues labeled `agent-ready`** (acceptance criteria complete + independently doable) that are unassigned. Self-assign to lock.
- **Acceptance criteria**: a human approves them (label `ac-approved`) before an Issue becomes `agent-ready`. You may *draft* them for human approval.
- **Do not change `engines.node` casually — and never as a side change.** Treat it like the risky operations below: propose it on its own, say what it excludes, and wait for an Owner. It rode into 0.1.4 inside an unrelated bigint fix, under a sub-commit titled "clarify node 24 support", and nothing in the pipeline objected.
- **`engines.node` decides installability, not preference.** npm does not error on a floor the caller cannot meet: resolving a range, it skips that version and installs the previous one **with no warning at all**, so raising the floor removes the release from everyone below it without telling any of them. (EBADENGINE appears only when a caller pins the exact version — which nobody does for a release they do not know exists.) 0.1.4 declared `>=24.19.0` on the reasoning that Node 22 had entered maintenance; `npm i @openbkn/bkn-sdk` then quietly returned 0.1.3 on every Node below that, and the release looked from the outside like it had never happened. The floor is the highest version a dependency or language feature actually requires — today `undici`'s `>=22.19.0` and native `JSON.rawJSON` / `JSON.parse` source-text access — and it must equal the `node-version` the `engines-floor` CI job runs, which [`test/unit/engines-floor.test.ts`](test/unit/engines-floor.test.ts) enforces. Support policy goes in the README; it does not belong in the field that decides whether anyone can install the package.
- **Risky operations** (deploy, delete/modify data, schema migration, prod config, secrets/permissions, major dependency bumps, `engines.node` changes, cross-service breaking changes): do **not** execute. Post the three-part confirmation (what / blast radius / rollback), apply label `awaiting-confirmation`, and wait for an Owner to apply `owner-confirmed`.
- **You may never**: approve or merge a PR, bypass or skip CI, or act without the confirmation above. Code review and the merge gates are human-only.
- **Open PRs with `Closes #<issue>`** and write back progress as Issue/PR comments. Label your PRs `by-agent`.
- **Stuck / off-track / tests won't pass** → comment the blocker, return the Issue to triage, clear your assignee, label `needs-human`.

## Commits & branches

- Conventional Commits: `type(scope): subject` (`feat` / `fix` / `chore` / `refactor` / `docs` / `test`; scope = service name).
- Branch from the Issue's "Create a branch"; one PR per Issue, kept small.
- Branch names must use a valid type prefix and at most two path segments after it: `<type>/<description>`, `<type>/<issue-number>-<description>`, or `<type>/<module>/<description>`; segments start with lowercase letters or digits and may contain `-`, `.`, or `_`.

---

## bkn-sdk-specific guidance

Unified TypeScript SDK + CLI for the **BKN** (Business Knowledge Network) platform. One toolkit, two audiences: end-users/agents (knowledge, agents, search, chat) and platform operators (org, user, role, model, audit). Backend-only; no web UI. Published to npm under `@openbkn`.

> This file is a **map**, not a manual. Start here, then follow links into `docs/`. Keep it under 120 lines.

## Priority order

1. Explicit user instructions (this chat).
2. This harness — `AGENTS.md`, then `docs/`.
3. Model defaults.

## Tech stack

| Concern | Choice |
| ------- | ------ |
| Language | TypeScript (ESM), Node ≥ 22.19.0 |
| CLI | `commander` + `@clack/prompts` (prompts) + `chalk`/`cli-table3` (output); no TUI |
| Validation | `zod` at IO boundaries |
| HTTP | native `fetch` |
| Build | `tsup` (dual: library + `openbkn` bin) |
| Test | `vitest` (UT), separate E2E entry |
| Lint + format | `biome` (lint + format in one) |
| Package manager | npm (single package) |

## Repo layout

| Path | Holds |
| ---- | ----- |
| `src/commands/` | CLI command handlers (parse argv → call resource → print) |
| `src/resources/` | Programmatic API surface (the exported SDK) |
| `src/api/` | Thin HTTP clients per backend service |
| `src/auth/` | OAuth, token resolution |
| `src/config/` | Config store, base-url/TLS resolution |
| `src/utils/` | Output formatting, errors, prompts |
| `src/help/` | Grouped-help formatter, section taxonomy, captured return shapes |
| `src/index.ts` | Library entry (exports `resources/`) |
| `src/cli.ts` | CLI entry (`openbkn` bin) |
| `docs/` | Harness: design, specs, plans, references |

## Architecture (layered)

Dependency direction is one-way: `commands → resources → api → auth/config`. Commands never call `fetch` directly; resources never parse argv. See [ARCHITECTURE.md](ARCHITECTURE.md).

## Self-describing surface

An agent reaches this CLI with no docs and has to work out what exists, what each
thing costs, and where an id comes from — from the CLI itself. That is a contract,
not a nicety, and it is checked by `test/unit/help-contract.test.ts`.

Every command sits in one of four sections, and the vocabulary is the same at every
level: **GROUPS** nests deeper, **READ** changes nothing, **RUN** acts without
changing configuration, **WRITE** changes platform state. Sections are assigned by
structure and verb in `src/help/grouped-help.ts`; a name the verb table does not know
falls into `COMMANDS`, which is visible rather than silently wrong. Override with
`groupChildren(cmd, {...})` in the command module — never by editing the verb table
for a one-off.

When you add a command, it is not done until:

- it has a one-line description that says what it answers, not what it calls;
- its section is right — if the verb table guessed, check that it guessed correctly;
- ids it takes are resolvable: add the minting command to `ID_SOURCES` /
  `GROUP_ID_SOURCES` in `src/commands/describe.ts`, or `ARGUMENT_OVERRIDES` when a
  command takes two different kinds of id;
- anything a caller must know before running it (order of work, a gate, a field that
  decides success) is in the group's `guide()` — prose belongs there, not in 30
  per-command descriptions;
- `--dry-run` still sends nothing: the preview hook lives in `tlsFetch`, the one
  choke point, and redacts credential-shaped headers *and* body fields;
- `--probe` knows which service answers it (`COMMAND_SERVICE` in
  `src/commands/probe.ts`);
- if it is READ, `scripts/capture-returns.mjs` can reach it — rerun that against a
  live deploy to refresh `src/help/returns.json`. READ means "changes nothing on the
  platform"; a command that writes to the local filesystem goes in its blacklist.

`openbkn describe [path] [--json] [--depth n] [--probe]` is the machine-readable view
of all of it. Check your work by reading it, not by reading the source.

## Secrets & logging

- Tokens live in `~/.bkn/` (config store) and env (`BKN_BASE_URL`, `BKN_TOKEN`). Never commit, never log.
- All code comments, docstrings, and log messages in **English**.
- Redact tokens/PII before any output. See [docs/SECURITY.md](docs/SECURITY.md).

## Testing bar

- `npm run lint` (biome + tsc `--noEmit`) and `npm test` (vitest UT, no external deps) must pass before "done".
- UT fully mocked; E2E (real backend) is a separate entry, not part of `npm test`.
- New behavior ships with a minimal test or runnable example. See [docs/QUALITY_SCORE.md](docs/QUALITY_SCORE.md).
- **A release is not verified until it installs.** `npm test` passing on the developer's Node says nothing about whether a user can obtain the package: run `npm i <pkg>` on the declared floor and check the version that actually lands. 0.1.4 passed every check and was still unreachable for most callers.

## Conventions

- Default list `limit` = **30**; query/preview `limit` = **50**; `--limit` always overrides.
- Global `--json` for machine-readable output where supported.
- This is a **rewrite**, not a port: reference the legacy user/agent-SDK and operator-CLI predecessors, but slim and unify — do not copy verbatim. The legacy Python SDK stays dropped; `python/` is a different thing — a generated, read-only OSDK, not a hand-written port of this surface.

## Domains

Behavior per product area lives in [docs/product-specs/](docs/product-specs/index.md): knowledge-networks · datasources · model-factory · skills-toolboxes · vega · bkn-trace · identity-access.

## How to use this harness

| Scenario | Start here | Then |
| -------- | ---------- | ---- |
| New feature | `docs/product-specs/<domain>.md` | Plan in `docs/exec-plans/active/` → implement → move to `completed/` |
| Bug fix | `docs/RELIABILITY.md` + `docs/SECURITY.md` | Fix → update `docs/QUALITY_SCORE.md` |
| Architecture change | `ARCHITECTURE.md` | Add `docs/design-docs/<name>.md` → link from index → implement |

Non-trivial work follows the Superpowers loop (design → plan → execute → verify): [docs/superpowers/workflow.md](docs/superpowers/workflow.md).

For tech debt, doc maintenance, and other workflows see [docs/PLANS.md](docs/PLANS.md).
