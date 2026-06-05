# Equivalence tests — `openbkn` vs legacy Kweaver CLIs

Guarantees the new `openbkn` CLI is behaviorally equivalent to the installed legacy
CLIs (`kweaver` + `kweaver-admin`) for every carried-over command — **including
`--help` content**. Tracking plan: [../../docs/exec-plans/active/2026-06-03-cli-equivalence-with-kweaver.md](../../docs/exec-plans/active/2026-06-03-cli-equivalence-with-kweaver.md).

## Layout

```text
test/equivalence/
  README.md            # this file
  command-map.md       # legacy command → openbkn command, with drop reasons
  capture-baselines.sh # regenerate golden help fixtures from installed legacy CLIs
  baselines/
    kweaver/*.help.txt            # depth-1 group help, one per command
    kweaver/_help-all.txt         # FULL-DEPTH signature manifest (every sub/sub-sub)
    kweaver-admin/*.help.txt      # depth-1 group help
    kweaver-admin/sub/*.help.txt  # depth-2 per-subcommand help (cmd__sub)
  help.test.ts         # recursive parity vs baselines (skips live cases until `openbkn` exists)
```

## What "equivalent" means

Equivalence is **full-depth / recursive** — top-level, subcommands, AND
sub-subcommands. Legacy tree size: **154 `kweaver` paths** (from `help all`) +
**43 `kweaver-admin` depth-2 paths**. Examples that must all match:
`openbkn agent --help`, `openbkn agent chat --help`, `openbkn bkn object-type --help`,
`openbkn bkn object-type query --help`.

1. **Command tree** — every legacy command/subcommand/sub-subcommand has a `openbkn` counterpart, or is in the `drop` list in [command-map.md](command-map.md).
2. **Flags & args** — same options, same required positionals, same aliases (`res`, `context`, `curl`).
3. **Help content** — `openbkn <cmd> --help` lists the same subcommands, flags, and required args the legacy help does. Cosmetic diffs (program name `kweaver`→`openbkn`, ordering, ANSI color) are normalized away; capabilities are not. Subcommand names are kept identical (incl. `bkn`), so no name remapping is needed.
4. **Behavior** — for deterministic `--json` commands, normalized output shape matches (UT against a mocked backend; E2E against a real backend).
5. **Exit codes** — same success/failure codes.

## How it runs

- **Now (no `openbkn` binary yet):** baselines are captured from the installed legacy CLIs and committed. `help.test.ts` auto-**skips** when `openbkn` is not on PATH / not built, so the suite is green and ready.
- **After Phase 2 (skeleton exists):** the test resolves the `openbkn` bin, runs `openbkn <cmd> --help` for each mapped command, normalizes, and asserts the legacy capability set is a subset of the new help.
- **Drift report:** any legacy command/flag missing from `openbkn` and not in the `drop` list → test failure.

## Regenerate baselines

```bash
test/equivalence/capture-baselines.sh   # needs `kweaver` + `kweaver-admin` on PATH
```

Commit the resulting diff so parity is reviewed when the legacy CLIs change.

## Captured so far

- `kweaver` v0.8.4 — 16 group helps + root + `help all` (154-path full-depth manifest)
- `kweaver-admin` v0.6.4 — 9 group helps + root + 43 depth-2 subcommand helps
