# Command map — legacy Kweaver CLIs → `openbkn`

The new `openbkn` CLI (`@openbkn/bkn-sdk`) merges two installed legacy CLIs:

- **`kweaver`** `@kweaver-ai/kweaver-sdk` v0.8.4 — user / agent side
- **`kweaver-admin`** `@kweaver-ai/kweaver-admin` v0.6.4 — operator side

Equivalence rule: every legacy command is either **matched** by a `openbkn` command (help + behavior parity) or **dropped** with a reason. Baselines for parity assertions live in [baselines/](baselines/) (regenerate via [capture-baselines.sh](capture-baselines.sh)).

Status legend: `keep` = same name · `rename` = path changes, behavior same · `merge` = two legacy commands unify · `drop` = intentionally removed.

## Binary name

The binary is **`openbkn`**. All subcommand names are kept **identical** to the
legacy CLIs — including the knowledge-network command `bkn` (`openbkn bkn list`).
Because the binary (`openbkn`) differs from its `bkn` subcommand, there is no
`bkn bkn` doubling and **no rename** — the command tree stays fully equivalent.

## `kweaver` (user side)

| Legacy | → `openbkn` | Status | Notes |
| ------ | ------- | ------ | ----- |
| `kweaver auth …` | `openbkn auth …` | merge | Unify with admin `auth`; one OAuth2 + token store at `~/.bkn/` |
| `kweaver token` | `openbkn auth token` | rename | Fold standalone `token` under `auth` |
| `kweaver config set-bd\|list-bd\|show` | `openbkn config …` | merge | Merge with admin `config`; keep business-domain subcommands |
| `kweaver agent …` (list, personal-list, category-list, template-list, template-get, get, get-by-key, create, update, delete, publish, unpublish, chat, sessions, history, trace, skill) | `openbkn agent …` | keep | Full subtree carried over |
| `kweaver toolbox …` (create, list, publish, unpublish, delete, export, import) | `openbkn toolbox …` | keep | |
| `kweaver tool …` (upload, list, enable, disable, execute, debug) | `openbkn tool …` | keep | |
| `kweaver bkn …` (list, get, create, create-from-catalog, create-from-csv, update, delete, build, stats, export, validate, push, pull, object-type, relation-type, relation-type-paths, action-type, concept-group, metric, search, subgraph, action-execution, action-log, action-schedule, job, resources) | `openbkn bkn …` | keep | Subcommand name `bkn` kept; whole subtree carried over **except `build`** (dropped — see drops; index build → `vega dataset build`) |
| `kweaver bkn create-from-ds` | — | drop | Already deprecated alias for `create-from-catalog` |
| `kweaver resource …` / `res` (list, find, get, query, delete) | `openbkn resource …` / `res` | keep | Keep `res` alias |
| `kweaver dataflow …` (list, run, runs, logs, templates, create-dataset, create-bkn, create) | `openbkn dataflow …` | keep | |
| `kweaver vega …` (health, stats, inspect, catalog, resource, dataset, query, sql, connector-type) | `openbkn vega …` | keep | `dataset build` enriched: full `CreateBuildTaskRequest` flags (`--mode`/`--embedding-fields`/`--embedding-model`/`--model-dimensions`/`--build-key-fields`) instead of legacy mode-only + raw `call /build-tasks`. Endpoint `POST /build-tasks`. Receives the dropped `bkn build` workload (see drops + [vega.md](../../docs/product-specs/vega.md)) |
| `kweaver context-loader …` / `context` (search-schema, query-object-instance, query-instance-subgraph, get-logic-properties, get-action-info, find-skills, tools, resources, resource, templates, prompts, prompt, tool-call) | `openbkn context …` | keep | Keep `context` alias; drop deprecated `kn-search`, `kn-schema-search`, legacy `config` subcommand |
| `kweaver context-loader kn-search\|kn-schema-search\|config` | — | drop | Deprecated in legacy help |
| `kweaver trace …` (diagnose, eval-set, schema validate) | `openbkn trace …` | keep | LLM-judged rules depend on `claude` CLI — preserve fallback behavior |
| `kweaver call` / `curl` | `openbkn call` / `curl` | merge | Unify with admin `call`; auto-inject auth headers |
| `kweaver model llm\|small …` | `openbkn model llm\|small …` | merge | Merge with admin `llm` + `small-model`; management → mf-model-manager, runtime → mf-model-api |
| `kweaver skill …` (registry/market/content/lifecycle subtree) | `openbkn skill …` | keep | Full subtree |
| `kweaver explore` | `openbkn explore` | keep (review) | Launches a local web UI; confirm it fits "backend-only" product scope before carrying over |
| `kweaver help [all]` | `openbkn help [all]` | keep | Preserve `help all` full-signature dump (migration aid) |

## `kweaver-admin` (operator side)

| Legacy | → `openbkn` | Status | Notes |
| ------ | ------- | ------ | ----- |
| `kweaver-admin auth …` (login, logout, status, whoami, list/ls, change-password, token) | `openbkn auth …` | merge | Same `auth` group as user side; superset of subcommands |
| `kweaver-admin org …` (list, tree, get, create, update, delete, members) | `openbkn org …` | keep | |
| `kweaver-admin user …` (list, get, create, update, delete, roles, assign-role, revoke-role, reset-password) | `openbkn user …` | keep | |
| `kweaver-admin role …` (list, get, members, add-member, remove-member, …) | `openbkn role …` | keep | |
| `kweaver-admin llm …` (list, get, add, edit, delete, test) | `openbkn model llm …` | merge | Unify under user-side `model llm`; management endpoints |
| `kweaver-admin small-model …` (list, get, add, edit, delete, test) | `openbkn model small …` | merge | Unify under `model small` |
| `kweaver-admin audit list` | `openbkn audit list` | keep | |
| `kweaver-admin config show\|set` | `openbkn config …` | merge | Merge with user-side `config` |
| `kweaver-admin call` | `openbkn call` | merge | Same unified `call` |

## Global flags — reconcile

| Concern | `kweaver` | `kweaver-admin` | `openbkn` (target) |
| ------- | --------- | --------------- | -------------- |
| Base URL | `--base-url` (env `KWEAVER_BASE_URL`) | `--base-url` | `--base-url` (env `BKN_BASE_URL`) |
| Token | `--token` (env `KWEAVER_TOKEN`) | per-platform store | `--token` (env `BKN_TOKEN`) |
| JSON output | `--pretty` / `--compact` | `--json` | Decide one: `--json` + `--compact` (document the mapping; both legacy spellings → same behavior) |
| Insecure TLS | `--insecure`/`-k` | `--insecure`/`-k` | `--insecure` / `-k` |
| Business domain | `-bd`/`--biz-domain` | `-bd` (on `call`) | `-bd` / `--biz-domain` |
| User select | `--user` (env `KWEAVER_USER`) | — | `--user` (env `BKN_USER`) |

## Environment & state (reconcile)

| Concern | Legacy | `openbkn` (target) |
| ------- | ------ | -------------- |
| Profile isolation | `KWEAVER_PROFILE` | `BKN_PROFILE` |
| Config root override | `KWEAVERC_CONFIG_DIR` (`~/.kweaver`) | `BKN_CONFIG_DIR` (`~/.bkn`) |
| Token store | `~/.kweaver` (sdk) / `~/.kweaver-admin/platforms/<host>` (admin) | unified under `~/.bkn/` |

## Help output

`openbkn --help` reproduces the legacy grouped sections (`AUTHENTICATION & CONFIG`,
`DECISION AGENT`, `AI DATA PLATFORM`, `TRACE AI`, `FOUNDATION`) plus a new
`OPERATOR` group for merged admin commands. `openbkn help all` = full per-action
signatures. See [../../docs/design-docs/cli-command-design.md](../../docs/design-docs/cli-command-design.md).

> Open question for the JSON flag: legacy `kweaver` defaults to `--pretty` and uses `--compact`; `kweaver-admin` uses `--json`. The equivalence test must accept that `openbkn` picks one canonical spelling and treats the others as documented aliases — not as a silent behavior drop.

## Intentional drops (must stay short & justified)

- `bkn build` — **backend capability removed.** The KN-level full-build job (`ontology-manager/.../jobs`, `job_type:"full"`) no longer exists. Index building moved to the Catalog/Vega build task: `openbkn vega dataset build <resource-id>` + `build-status`. `bkn create-from-catalog --build` repoints to the Catalog resource build, not a KN job.
- `bkn create-from-ds` — deprecated alias.
- `context-loader kn-search`, `kn-schema-search`, legacy `context-loader config` — deprecated.
- Python SDK — out of scope for this package entirely.

Anything not listed here as `drop` must have a matching `openbkn` command, or the drift report fails.
