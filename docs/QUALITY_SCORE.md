# Quality scorecard

Phase 2 toolchain landed. Each criterion cites a concrete repo signal; write **TBD** when none exists. Do not invent numbers.

| Criterion | Target | Signal / status |
| --------- | ------ | --------------- |
| Typecheck | `tsc --noEmit` clean | ✅ `tsconfig.json` (strict + `noUncheckedIndexedAccess`); `npm run typecheck` clean |
| Unit tests | green, no external deps | ✅ `npm test` = 110 passed / 194 skipped. Per-domain mocked-fetch UT across all real domains + pure-logic suites (PK detection, bkn validate, tar/zip round-trips, SSE stream parse, trace predicates, eval-set assertions, schema validate). Live LLM-judge test gated behind `BKN_JUDGE_LIVE=1` |
| Command coverage | all legacy domains implemented | ✅ Every legacy command/sub implemented. Highlights: full admin org/user/role CRUD + reset-password (thrift + RSA), bkn push/pull/validate/create-from-catalog/create-from-csv/relation-type-paths, agent chat (SSE) + skill members, model streaming + CRUD, skill zip register/download/install + republish, toolbox/tool upload + export/import, context MCP (incl. layer-2/3), dataflow create + templates, trace diagnose (symbolic + LLM rubric + synthesizer) + scan + eval-set + schema-validate, explore (bkn+vega). Intentional deferrals only: operator `auth` (→ top-level auth) and table output (JSON default) — see tech-debt |
| Live validation | read commands work vs real backend | ✅ Validated on the deployed VM across rounds. This round live-verified: admin org get/members, user get/roles; bkn push/pull round-trip (CHECKSUM/SKILL.md/network.bkn); `model llm chat --stream` (qwen3.6-plus streamed a real reply). Caught+fixed 4 earlier bugs (`-k`, vega base path, model `size`, toolbox `/list`); this round corrected admin user/org-get to thrift after REST 400/404 |
| Lint + format | `biome check` clean | ✅ `biome.json`; `npm run lint` (biome + tsc) clean |
| E2E | separate entry, runs vs real backend | TBD — excluded in `vitest.config.ts`; no `test/e2e/` yet |
| CLI equivalence | every legacy command/sub/sub-sub matched or dropped-with-reason | ✅ Full-depth: `BKN_EQUIV_LIVE=1` → **196/196 pass**. Every legacy command/sub exists in `openbkn` and its `--help` covers the legacy capability tokens (flags + Usage `<args>`), for both kweaver(sdk) top-level and kweaver-admin (nested 1:1 under `admin`). Tokenizer compares flags + usage args (prose-noise-free) |
| Docs freshness | spec updated in same PR as behavior | Enforced by review; see [PLANS.md](PLANS.md) workflows |
| CI | lint + test on PR | TBD — no workflow in `.github/` yet |

Update this table as each signal changes (e.g. live-parity count as commands are filled in).
