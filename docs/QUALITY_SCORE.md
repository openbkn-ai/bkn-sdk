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

## CLI reliability regression coverage

- `test/unit/trace-command.test.ts` runs the complete CLI tree and checks the
  outgoing query for conversation/interaction filters before and after the
  command. Ambient Trace context does not become an implicit search filter.
- `test/unit/http.test.ts` checks Authorization on the wire after refresh, request
  preservation, the one-refresh limit on failure, and BKN_TOKEN-origin 401 hints.
  The retry implementation was incorporated in upstream #110 before this PR.
- `test/unit/build-wait.test.ts` uses fake time to check short wait deadlines and
  a task completing during the final poll interval, alongside task failure and
  unlimited-wait cases. Status requests still use the normal HTTP timeout.
- `test/unit/push-integrity.test.ts` checks CLI request order, branch-scoped
  snapshots, binding/operator loss warnings, unreadable reads, and new networks.
  Verified SDK calls use the same comparison. An isolated network was imported
  twice on the 14.103.77.23 test environment without false integrity warnings.
- `test/unit/push-integrity-dry-run.test.ts` checks that `bkn push --dry-run`
  previews the upload POST with redacted credentials and sends no read or write.
- `test/unit/bkn-validate.test.ts` checks file/line diagnostics for misaligned
  Markdown rows, escaped pipes, line continuations, first-table truncation,
  interrupted rows, and mixed logic-property formats, plus rejection before any
  upload. Three existing BKN directories were checked for new false positives.
- `test/unit/query-object-instance.test.ts` checks the real CLI and SDK wrapper
  reject unknown argument names, malformed nested conditions, and extra filter
  or sort keys without making a request. Actual property membership needs
  object-type schema: no extra read
  or cached schema is available in an independent CLI invocation, so that
  validation remains a coverage gap.
