# Quality scorecard

Phase 2 toolchain landed. Each criterion cites a concrete repo signal; write **TBD** when none exists. Do not invent numbers.

| Criterion | Target | Signal / status |
| --------- | ------ | --------------- |
| Typecheck | `tsc --noEmit` clean | ✅ `tsconfig.json` (strict + `noUncheckedIndexedAccess`); `npm run typecheck` clean |
| Unit tests | green, no external deps | ✅ `npm test` is the release gate. Per-domain mocked-fetch UT includes ContextLoader receipt parsing, automatic lifecycle injection, identity-partitioned transport/catalog caches, CLI receipt JSON output, and privacy-safe lifecycle diagnostics; live LLM-judge test gated behind `BKN_JUDGE_LIVE=1` |
| Command coverage | every platform domain implemented | ✅ Full command tree implemented. Highlights: full admin org/user/role CRUD + reset-password (thrift + RSA), bkn push/pull/validate/create-from-catalog/relation-type-paths, agent chat (SSE) + skill members, model streaming + CRUD, skill zip register/download/install + republish, toolbox/tool upload + export/import, context MCP (incl. layer-2/3), trace diagnose (symbolic + LLM rubric + synthesizer) + scan + eval-set + schema-validate, explore (bkn+vega). Intentional deferrals only: operator `auth` (→ top-level auth) and table output (JSON default) — see tech-debt |
| Live validation | read commands work vs real backend | ✅ Validated on the deployed VM across rounds. This round live-verified: admin org get/members, user get/roles; bkn push/pull round-trip (CHECKSUM/SKILL.md/network.bkn); `model llm chat --stream` (qwen3.6-plus streamed a real reply). Caught+fixed 4 earlier bugs (`-k`, vega base path, model `size`, toolbox `/list`); this round corrected admin user/org-get to thrift after REST 400/404 |
| Lint + format | `biome check` clean | ✅ `biome.json`; `npm run lint` (biome + tsc) clean |
| E2E | separate entry, runs vs real backend | `test/e2e/live-smoke.sh` drives read paths; write-gated `test/e2e/live-write.sh` validates the ContextLoader `--receipt` envelope and same-identity authorized Receipt readback. Both are excluded from `vitest run` (`vitest.config.ts`) and run by hand. Two-identity denial plus response-drop exactly-once remains an approved-target release gate, not a mocked claim. |
| Docs freshness | spec updated in same PR as behavior | Enforced by review; see [PLANS.md](PLANS.md) workflows |
| CI | lint + test on PR | ✅ `.github/workflows/ci.yml` on push to `main` + all PRs: `check:deps` (own step, legible failure), `lint`, `test`, `build`. Release via `.github/workflows/release.yml` (OIDC Trusted Publishing + provenance) |

Update this table as each signal changes (e.g. live-parity count as commands are filled in).
