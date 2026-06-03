# Quality scorecard

Phase 2 toolchain landed. Each criterion cites a concrete repo signal; write **TBD** when none exists. Do not invent numbers.

| Criterion | Target | Signal / status |
| --------- | ------ | --------------- |
| Typecheck | `tsc --noEmit` clean | ✅ `tsconfig.json` (strict + `noUncheckedIndexedAccess`); `npm run typecheck` clean |
| Unit tests | green, no external deps | ✅ `npm test` = 51 passed / 193 skipped. Per-domain mocked-fetch UT (bkn/resource/dataflow/vega/agent/model/skill/toolbox/context) + jwt/resolve/auth/call |
| Coverage | meaningful on resources/api | Read surface covered per-domain; write mutations + trace engine not yet implemented |
| Live validation | read commands work vs real backend | ✅ Validated on the deployed VM: bkn/resource/dataflow/vega/agent/model/context/skill/toolbox list/read all return real data. Caught+fixed 3 real bugs (`-k`, vega base path, model `size`, toolbox `/list`) |
| Lint + format | `biome check` clean | ✅ `biome.json`; `npm run lint` (biome + tsc) clean |
| E2E | separate entry, runs vs real backend | TBD — excluded in `vitest.config.ts`; no `test/e2e/` yet |
| CLI equivalence | every legacy command/sub/sub-sub matched or dropped-with-reason | Full-depth baselines (kweaver `help all` = 154 + admin 43 depth-2). `BKN_EQUIV_LIVE=1` → **206/244 pass**. All 38 remaining are `openbkn admin` flag-coverage (operator subtree, deferred — no env to test) |
| Docs freshness | spec updated in same PR as behavior | Enforced by review; see [PLANS.md](PLANS.md) workflows |
| CI | lint + test on PR | TBD — no workflow in `.github/` yet |

Update this table as each signal changes (e.g. live-parity count as commands are filled in).
