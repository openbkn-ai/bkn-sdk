# Exec plan — CLI equivalence with legacy Kweaver CLI

Status: **active** · Opened 2026-06-03

## Goal

The new `openbkn` CLI (`@openbkn/bkn-sdk`) must be **behaviorally equivalent** to the installed legacy Kweaver CLIs (`kweaver` from `@kweaver-ai/kweaver-sdk` + `kweaver-admin` from `@kweaver-ai/kweaver-admin`) for every carried-over command — including **`--help` / help output content**.

"Equivalent" = same command tree, same flags/args, same option semantics, same exit codes, and help text that conveys the same capabilities (wording may be trimmed/unified, but no command, flag, or behavior may silently disappear).

**Full-depth.** Parity is recursive — top-level groups, subcommands, AND sub-subcommands all match. Legacy tree: **154 `kweaver` paths** (from `help all`) + **43 `kweaver-admin` depth-2 paths**. Help must render clearly at every level (grouped subcommands, USAGE/FLAGS/EXAMPLES), not just the root.

## Approach — golden-output equivalence harness

1. **Capture legacy baselines.** For each legacy command, record `--help` output and representative `--json` dry outputs from the installed `kweaver` / `kweaver-admin`. Store as golden fixtures under `test/equivalence/baselines/`.
2. **Build a command map.** Table mapping every legacy command → new `openbkn` command (see [../../design-docs/cli-command-design.md](../../design-docs/cli-command-design.md)). Mark each: kept-as-is / renamed / merged / intentionally-dropped (with reason).
3. **Help-content assertions.** For kept/renamed commands, assert the new `openbkn <cmd> --help` lists the same subcommands, flags, and required args as the baseline (normalize cosmetic diffs: program name, ordering, color).
4. **Behavioral assertions.** For commands with deterministic `--json` output, compare normalized JSON shapes against a mocked backend (UT) and, separately, against a real backend (E2E).
5. **Drift report.** Test emits a diff of any command/flag present in legacy but missing in `openbkn` that isn't on the intentional-drop list → fails CI.

## Steps

- [x] Inventory legacy command tree + flags — full-depth dump (kweaver `help all` + admin depth-2). Baselines committed under `test/equivalence/baselines/`.
- [x] Author `command-map.md` (legacy → bkn, with drop reasons + env/flag reconcile).
- [x] Write `test/equivalence/help.test.ts` — recursive parity (154 + 43 paths), skips live cases until binary exists.
- [ ] Land `openbkn` skeleton (Phase 2) so `--help` is invokable at every depth → test goes live.
- [ ] Implement the grouped-help formatter (root + per-command subcommand groups).
- [ ] Write `test/equivalence/behavior.test.ts` (JSON shape parity, mocked).
- [ ] Add E2E equivalence entry (real backend, separate from `npm test`).
- [ ] Wire drift report into CI; document in [../../QUALITY_SCORE.md](../../QUALITY_SCORE.md).

## Blocking dependency

Requires the `openbkn` CLI skeleton to exist (Phase 2 of [../../PLANS.md](../../PLANS.md)). Until then: baselines can be captured now from the installed legacy CLIs; assertions are stubbed.

## Done when

- Every legacy command is either matched by an equivalent `openbkn` command (help + behavior parity) or listed in the intentional-drop table with a reason.
- The drift report is clean (or only intentional drops remain) and runs in CI.
