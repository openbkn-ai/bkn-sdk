# Architecture — @openbkn/bkn-sdk

## Overview

```text
@openbkn/bkn-sdk
  |
  +--> bin: `openbkn`  (CLI entry, src/cli.ts)
  +--> lib: import { ... } from "@openbkn/bkn-sdk"  (src/index.ts → resources/)
  |
  +--> ~/.bkn/         (token + config store)
  +--> env: BKN_BASE_URL, BKN_TOKEN
  |
  +--> BKN platform backend (REST over fetch)
       +-- knowledge-networks / BKN engine
       +-- decision-agents + chat / conversations
       +-- dataflows
       +-- datasources
       +-- model-factory (llm + small-model + invocation)
       +-- skills + toolboxes (execution factory)
       +-- vega (data catalog / observability)
       +-- trace-ai (evidence chain, scan, diagnose, eval-set)
       +-- identity & access (OAuth/Hydra, org, user, role, audit)
```

## Layers & dependency direction

One-way only — an inner layer never imports an outer one:

```text
commands/ ──► resources/ ──► api/ ──► auth/ , config/ ──► utils/
 (CLI)        (SDK API)     (HTTP)    (tokens, base url)   (shared)
```

- **`commands/`** — Parse argv, validate flags, call a resource, print via `utils/output`. No `fetch`, no business logic.
- **`resources/`** — The exported programmatic SDK. Orchestrates `api/` calls, applies defaults (limits), returns typed data. Knows nothing about argv or stdout.
- **`api/`** — One thin client per backend service. Builds requests, sets headers, parses/validates responses with `zod`. No CLI concerns.
- **`auth/` + `config/`** — Resolve base URL and token (env → `~/.bkn/`), OAuth flows, TLS env. Pure, side-effect-scoped.
- **`utils/`** — Output (plain columns vs `--json`), error→exit-code mapping, prompts. Importable by any layer.

## Boundaries (enforced by review, ideally by lint)

- Validate shapes at IO edges (`api/` responses, CLI inputs) — parse, don't trust.
- Commands are thin; logic that two commands share belongs in a resource.
- A new backend service = a new `api/<service>.ts` + matching `resources/<domain>.ts`, never inline `fetch` in a command.

## Heritage

Rewritten from `kweaver-sdk` (user/agent SDK) + `kweaver-admin` (operator CLI), merged into one package and one `openbkn` CLI. Python SDK dropped. Reference the originals for behavior; reimplement slim. BKN format itself is defined by the upstream BKN specification — see [docs/references/bkn-spec-llms.txt](docs/references/bkn-spec-llms.txt).

## References

- [docs/DESIGN.md](docs/DESIGN.md) — design philosophy
- [docs/SECURITY.md](docs/SECURITY.md) — tokens, auth, audit
- [docs/design-docs/index.md](docs/design-docs/index.md) — design doc catalog
- [docs/product-specs/index.md](docs/product-specs/index.md) — per-domain behavior
