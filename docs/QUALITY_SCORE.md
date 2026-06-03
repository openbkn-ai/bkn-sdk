# Quality scorecard

Phase 2 toolchain landed. Each criterion cites a concrete repo signal; write **TBD** when none exists. Do not invent numbers.

| Criterion | Target | Signal / status |
| --------- | ------ | --------------- |
| Typecheck | `tsc --noEmit` clean | ✅ `tsconfig.json` (strict + `noUncheckedIndexedAccess`); `npm run typecheck` clean |
| Unit tests | green, no external deps | ✅ `npm test` = 59 passed / 193 skipped. Per-domain mocked-fetch UT across all real domains |
| Command coverage | all legacy domains implemented | ✅ Real handlers across every top-level domain (auth/config/call/bkn/resource/dataflow/vega/context/agent/model/skill/toolbox/tool/trace + admin). Remaining stubs: trace diagnose engine, bkn push/pull/validate + create-from-catalog, admin user/org CRUD detail, explore — see tech-debt |
| Live validation | read commands work vs real backend | ✅ Validated on the deployed VM: bkn/resource/dataflow/vega/agent/model/context/skill/toolbox return real data. Caught+fixed 4 real bugs (`-k`, vega base path, model `size`, toolbox `/list`) before the token expired |
| Lint + format | `biome check` clean | ✅ `biome.json`; `npm run lint` (biome + tsc) clean |
| E2E | separate entry, runs vs real backend | TBD — excluded in `vitest.config.ts`; no `test/e2e/` yet |
| CLI equivalence | every legacy command/sub/sub-sub matched or dropped-with-reason | Full-depth baselines (kweaver `help all` = 154 + admin 43 depth-2). `BKN_EQUIV_LIVE=1` → **215/252 pass**. Remaining 37 are `openbkn admin` depth-2 flag-coverage (operator CRUD detail flags not yet exhaustively added; no env to test) |
| Docs freshness | spec updated in same PR as behavior | Enforced by review; see [PLANS.md](PLANS.md) workflows |
| CI | lint + test on PR | TBD — no workflow in `.github/` yet |

Update this table as each signal changes (e.g. live-parity count as commands are filled in).
