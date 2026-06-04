# Plans (roadmap)

Product-level roadmap. Task-level execution plans live in [exec-plans/active/](exec-plans/active/) and design/impl artifacts in [superpowers/](superpowers/plans/).

## Phases

- **Phase 1 — Harness (done).** Scaffold AGENTS.md, ARCHITECTURE.md, structured `docs/`.
- **Phase 2 — Core scaffolding (done).** `package.json` (`@openbkn/bkn-sdk`, dual lib+bin), `tsup`, `tsconfig`, `biome`, `vitest`, base layers (`config/`, `api/{http,headers}`, `utils/{output,errors}`), `createClient`, grouped-help formatter, full grouped command tree (real: `config`, `vega` BuildTask; rest stubbed). `lint`/`test`/`build` green; `openbkn --help` runnable.
- **Phase 3 — Domains (done).** Every legacy command/sub implemented across all domains (see QUALITY_SCORE command-coverage row): bkn (full schema + push/pull/validate/create-from-catalog/create-from-csv/relation-type-paths/resources), resource, dataflow (+ templates), vega, context (MCP + layer-2/3), agent (CRUD + SSE chat + skill members + trace), model (CRUD + streaming), skill (zip register/download/install + lifecycle), toolbox/tool (upload + impex export/import), trace (diagnose symbolic+rubric+synthesizer, scan, eval-set, schema-validate), admin (org/user/role CRUD + reset-password + tree + audit + call), explore (bkn+vega). Intentional deferrals: operator `auth` (→ top-level auth), human table output (JSON default). All live-verified on the VM where data permitted.
- **Phase 3 (history) — Domains (largely done).** Real handlers across every domain: bkn (KN CRUD + full schema: object/relation/action-type, metric, concept-group, action-log/schedule, job, **push/pull tar import/export**), resource, dataflow, vega (catalog/resource/connector/build), context (MCP incl. **resources/templates/prompts**), agent (CRUD + sessions), model (llm/small + invocation + **streaming chat** + **add/edit/delete/test**), skill, toolbox/tool, trace (get/search), admin (org list/**get/members**, user list/**get/roles**, role list/get/members, audit/model/config). All this round's additions live-verified on the VM. Remaining (deferred — see tech-debt): trace diagnose engine, agent chat streaming, bkn validate + create-from-*, admin destructive writes, skill/tool/dataflow uploads, explore.
- **Phase 4 — Operator-side domains.** Port-slim from `kweaver-admin`: identity-access (org/user/role/oauth/audit), model-factory management.
- **Phase 5 — Unify CLI.** Single `openbkn` command tree across both audiences; consistent `--json` and limits.
- **Phase 6 — Publish.** First `@openbkn/bkn-sdk` release to npm; README (en + zh), docs site.

## Workflows

- **Tech debt** — log in [exec-plans/tech-debt-tracker.md](exec-plans/tech-debt-tracker.md); pay down in small PRs, not big-bang days.
- **Doc freshness** — when behavior changes, update the matching `product-specs/<domain>.md` in the same PR; run a link pass periodically.
- **New domain** — add `product-specs/<domain>.md`, link from its index, then create an exec plan.
- **Design change** — add `design-docs/<name>.md`, link from index, then implement.
