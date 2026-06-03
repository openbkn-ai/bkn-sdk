# Quality scorecard

Phase 2 toolchain landed. Each criterion cites a concrete repo signal; write **TBD** when none exists. Do not invent numbers.

| Criterion | Target | Signal / status |
| --------- | ------ | --------------- |
| Typecheck | `tsc --noEmit` clean | ✅ `tsconfig.json` (strict + `noUncheckedIndexedAccess`); `npm run typecheck` clean |
| Unit tests | green, no external deps | ✅ `npm test` = 65 passed / 193 skipped. Per-domain mocked-fetch UT across all real domains (incl. admin thrift reads, bkn tar round-trip, SSE stream parse) |
| Command coverage | all legacy domains implemented | ✅ Real handlers across every top-level domain. This round added: admin org get/members + user get/roles (ISFWeb thrift + accessor_roles), bkn push/pull (local tar), model `llm chat --stream` (SSE) + model add/edit/delete/test, context resources/templates/prompts (MCP). Remaining stubs (deferred, see tech-debt): trace diagnose engine, agent chat streaming, bkn validate + create-from-*, admin destructive writes, skill/tool/dataflow uploads, explore |
| Live validation | read commands work vs real backend | ✅ Validated on the deployed VM across rounds. This round live-verified: admin org get/members, user get/roles; bkn push/pull round-trip (CHECKSUM/SKILL.md/network.bkn); `model llm chat --stream` (qwen3.6-plus streamed a real reply). Caught+fixed 4 earlier bugs (`-k`, vega base path, model `size`, toolbox `/list`); this round corrected admin user/org-get to thrift after REST 400/404 |
| Lint + format | `biome check` clean | ✅ `biome.json`; `npm run lint` (biome + tsc) clean |
| E2E | separate entry, runs vs real backend | TBD — excluded in `vitest.config.ts`; no `test/e2e/` yet |
| CLI equivalence | every legacy command/sub/sub-sub matched or dropped-with-reason | Full-depth baselines (kweaver `help all` = 154 + admin 43 depth-2). `BKN_EQUIV_LIVE=1` → **215/252 pass**. Remaining 37 are `openbkn admin` depth-2 flag-coverage (operator CRUD detail flags not yet exhaustively added; no env to test) |
| Docs freshness | spec updated in same PR as behavior | Enforced by review; see [PLANS.md](PLANS.md) workflows |
| CI | lint + test on PR | TBD — no workflow in `.github/` yet |

Update this table as each signal changes (e.g. live-parity count as commands are filled in).
