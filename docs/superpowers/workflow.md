# Superpowers workflow

Development loop for non-trivial work. Priority: user instructions (`AGENTS.md`, chat) > this workflow > model defaults.

## Phases

1. **Gate** — Is this trivial? Trivial mechanical edits skip straight to execute. Everything else continues.
2. **Design** — Write a dated spec in [specs/](specs/) (`YYYY-MM-DD-<topic>-design.md`) before coding. Capture intent, options, chosen approach, affected layers.
3. **Plan** — Write a dated plan in [plans/](plans/) (`YYYY-MM-DD-<feature>.md`) or an exec plan in [../exec-plans/active/](../exec-plans/active/). Break into verifiable steps.
4. **Execute** — Implement against the plan. Keep diffs scoped; respect layer boundaries (`commands → resources → api → auth/config`).
5. **Debug** — Reproduce, fix root cause, add a regression test.
6. **Verify** — `npm run lint` + `npm test` green; behavior matches the spec; docs updated in the same PR.
7. **Ship** — Move the exec plan `active/` → `completed/`; update [../QUALITY_SCORE.md](../QUALITY_SCORE.md) if signals changed.

## Artifacts

- Designs → `docs/superpowers/specs/`
- Plans → `docs/superpowers/plans/` (or `docs/exec-plans/active/`)
- Tech debt → [../exec-plans/tech-debt-tracker.md](../exec-plans/tech-debt-tracker.md)

## Anti-patterns

- Writing code before an accepted design for non-trivial work.
- Marking "done" before verification.
- Copying legacy `kweaver-*` code verbatim instead of reimplementing slim.
