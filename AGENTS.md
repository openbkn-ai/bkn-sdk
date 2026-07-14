# AGENTS.md — @openbkn/bkn-sdk

Unified TypeScript SDK + CLI for the **BKN** (Business Knowledge Network) platform. One toolkit, two audiences: end-users/agents (knowledge, agents, search, chat) and platform operators (org, user, role, model, audit). Backend-only; no web UI. Published to npm under `@openbkn`.

> This file is a **map**, not a manual. Start here, then follow links into `docs/`. Keep it under 120 lines.

## Priority order

1. Explicit user instructions (this chat).
2. This harness — `AGENTS.md`, then `docs/`.
3. Model defaults.

## Tech stack

| Concern | Choice |
| ------- | ------ |
| Language | TypeScript (ESM), Node ≥ 22 |
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
