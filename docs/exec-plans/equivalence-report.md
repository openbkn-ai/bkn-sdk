# CLI Equivalence Report — `openbkn` vs `kweaver` / `kweaver-admin`

Generated from the full-depth parity suite (`test/equivalence/help.test.ts`, run
with `BKN_EQUIV_LIVE=1` against the built `dist/cli.js`).

## Result

**196 / 196 pass.** Every legacy command, subcommand, and sub-subcommand exists
under `openbkn`, and each node's `--help` covers the legacy **capability tokens**
(every `--flag` + every positional `<arg>` from the Usage line).

- kweaver (SDK) top-level → `openbkn …` : **150** cases
- kweaver-admin → `openbkn admin …` (nested 1:1) : **43** cases
- manifest / fixture (tree-shape) : **3** cases

Mapping rules: `kweaver <x>` → `openbkn <x>`; `kweaver-admin <x>` → `openbkn admin <x>`;
folds: `context-loader` → `context`, standalone `token` → `auth token`. Binary
renamed `kweaver` → `openbkn`. No legacy command dropped.

## How equivalence is measured

For each legacy path the test asserts (a) the mapped `openbkn <path> --help`
runs (tree-shape parity at every depth) and (b) the new help's capability tokens
are a superset of the legacy node's. A token = a `--flag` or a Usage `<arg>`/`[arg]`
name — symmetric across both CLIs (both are commander) and free of
wrapped-description prose. Output format differs by design (`openbkn` defaults to
a human table; `--json` is the exact machine path) — the test compares
capabilities, not rendering.

## Coverage by command group

| Group | Cases | Notes |
|-------|------:|-------|
| `bkn` | 43 | KN CRUD, object/relation/action-type, metric, concept-group, action-log/schedule, job, subgraph, relation-type-paths, resources, push/pull/validate, create-from-catalog, create-from-csv |
| `context` | 19 | MCP: search-schema, query-object-instance, find-skills, tools/tool-call, resources/templates/prompts, layer-2/3 |
| `vega` | 16 | catalog list/get/resources, connector-types, build task |
| `skill` | 16 | list/market/get/content/read-file/history/set-status, register/download/install, update-metadata/package, republish/publish-history |
| `auth` | 13 | login (token / password OAuth / browser PKCE), status/token/whoami/list/use/switch/users/export/logout/delete/change-password |
| `agent` | 11 | CRUD, chat (+stream), sessions, history, trace, skill add/remove/list |
| `dataflow` | 8 | list/runs/logs/run, create, templates, create-dataset, create-bkn |
| `toolbox` | 7 | list/create/publish/unpublish/delete, export, import |
| `tool` | 6 | upload, list, execute, debug, set-status |
| `resource` | 5 | list/find/get/query/delete |
| `model` | 3 | llm / small groups (+ chat / embeddings / rerank) |
| `config` | 3 | show / set / list |
| `call` | 1 | curl-style passthrough (alias `curl`) |
| **`admin`** | **43** | org (9) · user (9) · auth (7) · org-sub (7) · small-model (6) · llm (6) · role (5) · config (2) · audit (1) — operator surface nested 1:1 |

## Live validation (beyond `--help` parity)

Run against the dev VM with an admin token, real backend responses (not stubs):

- **admin**: full org/user/role read + write lifecycle incl. `reset-password` (created & deleted throwaway org/user in place), `org tree`, `call` passthrough.
- **auth**: headless password OAuth login (real admin UUID + JWT identity), token attach.
- **bkn**: push/pull tar round-trip, relation-type-paths, resources, `validate` vs `examples/06-world-cup` (27 OT / 29 RT / 4 CG).
- **agent**: chat non-stream + SSE stream (real reply), skill list.
- **model**: `llm chat --stream` (qwen3.6-plus), add/edit/delete/test.
- **skill**: register → install → download → delete round-trip (frontmatter preserved).
- **context**: MCP layer-2/3 tools, resources/prompts.
- **dataflow**: `create-dataset --template document` created a real dataset (cleaned up).
- **trace**: `diagnose` symbolic + rubric + synthesizer via the local `claude` CLI (gated live test).
- **vega/resource/dataflow** reads: byte-identical to legacy where compared.

## Environment-gated (code correct, this VM can't exercise end-to-end)

- `create-from-catalog` / `create-from-csv` full real-table run: needs a **physical** Vega catalog (this VM has only logical BKN catalogs). Orchestration wiring verified to the backend.
- `trace diagnose` on a real trace: this deploy's OpenSearch trace index is unpopulated (`no such index`). Engine logic unit-tested; LLM judge live-verified on synthetic spans.
- `admin audit` (`eacp/.../login-log`): true 404 on this gateway (route not registered). EACP itself is up.
- `auth change-password` (`eacp/.../modifypassword`): route live (reaches RSA decrypt); not run end-to-end to avoid changing the admin password — same RSA key proven by `admin user reset-password` (live 200).

## Quality signals

- `npm run lint` (biome + `tsc --noEmit`): clean
- `npm test`: 116 unit passed
- `npm run build` (tsup): clean
- equivalence: 196/196 (`BKN_EQUIV_LIVE=1`)
