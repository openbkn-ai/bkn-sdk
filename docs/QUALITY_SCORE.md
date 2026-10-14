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

## Dependency audit (2026-10-13 working-tree verification)

- Removed unused `csv-parse`; raised the supported dependency floors to
  `js-yaml ^4.3.2` and `undici ^8.10.2`. The lockfile resolves `js-yaml 4.3.2`,
  `undici 8.11.2`, `nanoid 3.3.20`, `postcss 8.5.30`, and `source-map-js 1.2.2`.
- After Owner confirmation, upgraded Vitest to 4.1.11 and added an esbuild
  `^0.28.1` override (resolved 0.28.2). Full `npm audit --json` and production-only
  audit report zero vulnerabilities. tsup's declared compatibility range still
  excludes esbuild 0.28; see the tech debt tracker for override maintenance.
- `npm run lint`, `npm run check:version`, `npm test` (1260 passed, one optional
  live test skipped), and `npm run build` passed. A clean install, full lint/test,
  and build also passed on Node 22.19.0 after the major migration. The packed
  working-tree CLI ran and the SDK imported on that floor; its installed dependency tree
  also audited with zero vulnerabilities. These results do not change the
  already published `0.2.0-rc.1` artifact.

## CLI reliability regression coverage

- `model-sdk-completion.test.ts` and `model-command.test.ts` cover SDK/CLI metadata redaction and bigint preservation, shared LLM ID resolution, typed option forwarding, tool messages/chunks, SSE errors and premature EOF, callback failures, byte-split UTF-8/CRLF, empty data keep-alives, provider message extension preservation, cancellation, timeouts, and reader cleanup. `test/e2e/model-sdk.mjs` live-verified existing qwen3.8-max name/ID chat and stream, CLI options, small-model adapter masking, and tool-call parameters on 23; no tool was executed.

- `test/unit/metric-validation.test.ts` checks HTTP-200 negative validation results, CLI JSON output and nonzero exit status, malformed responses (including JSON null), HTTP failures, and legacy empty HTTP 200/204 success normalization in SDK and CLI. `test/e2e/metric-validation.mjs` verified the existing `m_order_cnt` Metric on 14.103.77.23: SDK valid=true, CLI exit 0, missing dependency HTTP 400/exit 1, and unchanged Metric IDs/count. `test/unit/knowledge-networks.test.ts` checks SDK reads with omitted `data_properties`; the existing query and push-integrity regressions cover empty-schema behavior. `test/unit/vega.test.ts` checks the published index-capabilities API hint while retaining legacy empty-list normalization.
- `test/unit/trace-command.test.ts` runs the complete CLI tree and checks the
  outgoing query for conversation/interaction filters before and after the
  command. Ambient Trace context does not become an implicit search filter.
- `test/unit/http.test.ts` checks Authorization on the wire after refresh, request
  preservation, the one-refresh limit on failure, and BKN_TOKEN-origin 401 hints.
  Transient-failure retry is not implemented; it is designed in a separate change.
- `test/unit/build-wait.test.ts` uses fake time to check short wait deadlines and
  a task completing during the final poll interval, alongside task failure and
  unlimited-wait cases. Status requests still use the normal HTTP timeout.
- `test/unit/push-integrity.test.ts` checks CLI request order, branch-scoped
  snapshots, binding/operator loss warnings, unreadable reads, new networks,
  omitted `data_properties`, and 401/403 pre-push reads that warn and upload.
  Verified SDK calls use the same comparison. An isolated network was imported
  twice on the 14.103.77.23 test environment without false integrity warnings.
- `test/unit/push-integrity-dry-run.test.ts` checks that `bkn push --dry-run`
  previews the upload POST with redacted credentials and sends no read or write.
- `test/unit/bkn-validate.test.ts` checks file/line diagnostics for misaligned
  Markdown rows, escaped pipes, line continuations, first-table truncation,
  interrupted rows, and mixed logic-property formats, plus rejection before any
  upload. Three existing BKN directories were checked for new false positives.
- `test/unit/query-object-instance.test.ts` checks the real CLI and SDK wrapper
  reject unknown argument names, malformed nested conditions, extra filter or
  sort keys, combined `condition`/`filters`, `cursor`/`offset`, and mismatched
  `kn_id` before any request. Legacy `search_after` is rejected with cursor migration
  guidance at both the SDK and CLI entry points, without sending requests. It verifies
  that a nonempty `properties` list triggers one schema GET and missing or
  invisible fields stop the MCP query. `test/unit/auth-command.test.ts` checks
  that the env-shadow warning does not print URL credentials. The 401 hint in
  `test/unit/http.test.ts` also strips URL userinfo and query tokens before
  suggesting a new login.
  `test/unit/query-object-instance-dry-run.test.ts` checks that the query preview
  sends nothing, including schema reads and MCP handshakes.

- `test/unit/resources.test.ts` verifies independent top-level exact statistics, valid zero counts, unknown collection times, and no fallback to legacy metadata statistics. Type assertions ensure resource summaries do not declare exact or estimated counts or count collection times.

- `knowledge-networks-contract.test.ts` and `bkn-command-flags.test.ts` verify
  `ignore_local_index` / `--ignore-local-index` forwarding. Python query tests
  verify the source bypass option and the actual `Page.query_source` response.

- Python traced-query tests verify opaque cursor continuation and multi-page
  iteration stay on MCP, preserve the interaction and row receipts, and send
  no REST requests.
