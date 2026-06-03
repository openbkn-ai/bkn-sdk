# Core beliefs

1. **One core, two surfaces.** Domain logic lives in `resources/`. CLI and SDK are both thin shells over it; never duplicate logic in a command.
2. **Parse at the boundary.** Validate argv and HTTP responses with `zod` at the edge; trust the typed core inward.
3. **Layers are one-way.** `commands → resources → api → auth/config → utils`. An inner layer never imports an outer one. A new service = new `api/` + `resources/`, not inline `fetch`.
4. **English everywhere in code.** Comments, docstrings, log messages — English. User-facing CLI text may be localized; logs are not.
5. **Predictable defaults, explicit overrides.** List limit 30, query limit 50, `--json` where it makes sense. Flags override; nothing silently surprises.
6. **Slim beats faithful.** This is a rewrite. Reference the legacy code, reimplement lean, delete unused surface. No verbatim copying.
7. **Errors are actionable.** Every failure maps to a clear message and a non-zero exit code. Auth errors point to `openbkn auth login`.
8. **Entropy down each PR.** Prefer root-cause fixes; keep diffs scoped; consolidate duplication; update the matching spec in the same change.
9. **Concise above all.** Fewest moving parts that work. No TUI, no clever abstractions, minimal deps. Prefer a small plain function over a framework. Delete before you add.
10. **Import must be trivial.** `import { ... } from "@openbkn/bkn-sdk"` gives a typed client with zero side effects on import (no network, no fs, no env reads at module load). The SDK is usable without ever touching the CLI; the CLI is a thin consumer of it.
