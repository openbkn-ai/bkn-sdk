# Trace AI (evidence & observability)

## Goal

Full-chain observability for agent decisions: inspect the evidence chain ("how was this answer derived"), scan traces against rules, diagnose issues, and build eval sets.

## User-visible behavior

- `openbkn trace list` — traces (limit 30); `openbkn trace get <id>` — evidence chain / data provenance for one decision.
- `openbkn trace scan <id>` — run built-in rules over a trace.
- `openbkn trace diagnose <id>` — diagnose a trace against built-in diagnostic rules.
- Eval-set tooling: build rubric-based evaluation sets from traces.

## SDK touchpoints

- `resources/` trace surface over `api/trace.ts`; rule/prompt assets (yaml + `.prompt.md`) ship as bundled data files.
- Sub-areas mirror the legacy layout: `scan`, `diagnose`, `eval-set`, `exp`.

## Edge cases

- Built-in rule/prompt files must be packaged into the build output (not just `src/`).
- Large traces: render the chain incrementally; `--json` emits the structured graph.
- Diagnose/scan results cite the specific rule that fired.
