# Design

`@openbkn/bkn-sdk` optimizes for **one coherent surface** over the BKN platform: the same domain logic backs both the `openbkn` CLI and the importable SDK, so a behavior is implemented once and exposed twice.

What we optimize for:

- **Unification** — one package, one CLI, one auth/config model. No split between "user SDK" and "admin CLI".
- **Thin edges, typed core** — argv and HTTP responses are validated at the boundary (`zod`); the middle is plain typed functions.
- **Predictable defaults** — list `limit` 30, query `limit` 50, `--json` everywhere it makes sense; overridable, never surprising.
- **Slim over complete** — a deliberate rewrite of `kweaver-sdk` + `kweaver-admin`, not a port. Drop dead surface; keep what users actually call. No TUI, minimal deps, smallest code that works.
- **Trivial to import** — `import { ... } from "@openbkn/bkn-sdk"` yields a typed client with no import-time side effects; the CLI is just a thin shell over the same functions.
- **Agent-readable** — clear names, indexed docs, stable command tree, so coding agents and humans navigate the same way.

Engineering principles: [design-docs/core-beliefs.md](design-docs/core-beliefs.md). Full catalog: [design-docs/index.md](design-docs/index.md).
