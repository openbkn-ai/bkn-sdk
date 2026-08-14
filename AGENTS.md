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
- **Risky operations** (deploy, delete/modify data, schema migration, prod config, secrets/permissions, major dependency bumps, cross-service breaking changes): do **not** execute. Post the three-part confirmation (what / blast radius / rollback), apply label `awaiting-confirmation`, and wait for an Owner to apply `owner-confirmed`.
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
| Language | TypeScript (ESM), Node ≥ 24.19.0 |
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
| `src/index.ts` | Library entry (exports `resources/`) |
| `src/cli.ts` | CLI entry (`openbkn` bin) |
| `docs/` | Harness: design, specs, plans, references |

## Architecture (layered)

Dependency direction is one-way: `commands → resources → api → auth/config`. Commands never call `fetch` directly; resources never parse argv. See [ARCHITECTURE.md](ARCHITECTURE.md).

## Secrets & logging

- Tokens live in `~/.bkn/` (config store) and env (`BKN_BASE_URL`, `BKN_TOKEN`). Never commit, never log.
- All code comments, docstrings, and log messages in **English**.
- Redact tokens/PII before any output. See [docs/SECURITY.md](docs/SECURITY.md).

## Testing bar

- `npm run lint` (biome + tsc `--noEmit`) and `npm test` (vitest UT, no external deps) must pass before "done".
- UT fully mocked; E2E (real backend) is a separate entry, not part of `npm test`.
- New behavior ships with a minimal test or runnable example. See [docs/QUALITY_SCORE.md](docs/QUALITY_SCORE.md).

## Conventions

- Default list `limit` = **30**; query/preview `limit` = **50**; `--limit` always overrides.
- Global `--json` for machine-readable output where supported.
- This is a **rewrite**, not a port: reference the legacy user/agent-SDK and operator-CLI predecessors, but slim and unify — do not copy verbatim. Python SDK is dropped.

## Domains

Behavior per product area lives in [docs/product-specs/](docs/product-specs/index.md): knowledge-networks · decision-agents · dataflows · datasources · model-factory · skills-toolboxes · vega · bkn-trace · identity-access.

## How to use this harness

| Scenario | Start here | Then |
| -------- | ---------- | ---- |
| New feature | `docs/product-specs/<domain>.md` | Plan in `docs/exec-plans/active/` → implement → move to `completed/` |
| Bug fix | `docs/RELIABILITY.md` + `docs/SECURITY.md` | Fix → update `docs/QUALITY_SCORE.md` |
| Architecture change | `ARCHITECTURE.md` | Add `docs/design-docs/<name>.md` → link from index → implement |

Non-trivial work follows the Superpowers loop (design → plan → execute → verify): [docs/superpowers/workflow.md](docs/superpowers/workflow.md).

For tech debt, doc maintenance, and other workflows see [docs/PLANS.md](docs/PLANS.md).
