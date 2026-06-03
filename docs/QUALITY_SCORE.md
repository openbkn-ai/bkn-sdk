# Quality scorecard

Phase 2 toolchain landed. Each criterion cites a concrete repo signal; write **TBD** when none exists. Do not invent numbers.

| Criterion | Target | Signal / status |
| --------- | ------ | --------------- |
| Typecheck | `tsc --noEmit` clean | ✅ `tsconfig.json` (strict + `noUncheckedIndexedAccess`); `npm run typecheck` clean |
| Unit tests | green, no external deps | ✅ `npm test` = 19 passed / 193 skipped. UT for jwt, call helpers, resolve precedence, auth store round-trip |
| Coverage | meaningful on resources/api | Partial — real UT on jwt/resolve/auth/call; api/http + vega/resources still uncovered |
| Lint + format | `biome check` clean | ✅ `biome.json`; `npm run lint` (biome + tsc) clean |
| E2E | separate entry, runs vs real backend | TBD — excluded in `vitest.config.ts`; no `test/e2e/` yet |
| CLI equivalence | every legacy command/sub/sub-sub matched or dropped-with-reason | Full-depth baselines (kweaver `help all` = 154 + admin 43 depth-2). `npm test` skips live cases; `BKN_EQUIV_LIVE=1` → **158/196 pass** (38 remain: admin depth-2 flags + deep leaves not yet registered) |
| Docs freshness | spec updated in same PR as behavior | Enforced by review; see [PLANS.md](PLANS.md) workflows |
| CI | lint + test on PR | TBD — no workflow in `.github/` yet |

Update this table as each signal changes (e.g. live-parity count as commands are filled in).
