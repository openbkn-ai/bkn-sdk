# bkn — knowledge networks

`openbkn bkn …` operates knowledge networks (KNs): the schema (object/relation/action
types, metrics, concept groups), instance queries, semantic search, action
execution/logs/schedules, build jobs, and local package push/pull. Backends:
`ontology-manager` (schema + metric definitions), `ontology-query` (instance/metric
data, subgraph, action exec), `agent-retrieval` (semantic search), `bkn-backend`
(concept groups, schedules, jobs, relation-type paths, tar import/export).

## Conventions that apply to almost every command

- **`<kn-id>` is the first positional** on nearly all subcommands — a KN id, not a
  name. Get one from `bkn list`.
- **`--body` / `--body-file` are the write path.** Any create/update/query/execute
  that takes a JSON payload accepts EITHER `--body '<json-string>'` OR
  `--body-file <path>`. Exactly one is required; missing both →
  `Provide --body '<json>' or --body-file <path>.`; malformed JSON →
  `Request body is not valid JSON.` Bodies are **passed through verbatim** to the
  backend (the CLI does not validate shape), so the field names you send must match
  the backend's contract.
- **Output is JSON.** Global flags (put them before or after the subcommand):
  `--json` machine output, `--compact` single-line, `--full` show all columns
  (default trims to key ones). Auth/target: `--base-url` (env `BKN_BASE_URL`),
  `--token` (env `BKN_TOKEN`), `--user <id|name>` (env `BKN_USER`),
  `--biz-domain`/`-bd`, `-k`/`--insecure` (skip TLS, dev only).
- **Schema list default is "all".** `object-type`/`relation-type`/`action-type`/
  `metric` list calls send `limit=-1` (backend = all) and `branch=main` by default.
- **Branches.** Schema lives on a branch; default `main` everywhere a `--branch`
  exists (`object-type list`, `create`, `push`, `pull`).
- **comma-joined id args** (not flags) on the bulk deletes:
  `concept-group remove-members <ot-ids>`, `action-schedule delete <schedule-ids>`,
  `job delete <job-ids>`.
- There is **NO `bkn build`** — KN-level build was removed. The OpenSearch/vector
  index is built per **Vega resource** (`vega dataset build`, or the `--build` flag
  on `push` / `create-from-*`). See [vega.md](vega.md).

## Command map

| Command | Endpoint (method) | Notes |
| --- | --- | --- |
| `list` | `GET ontology-manager/.../knowledge-networks` | Paged + filterable. |
| `get <kn-id> [--stats] [--export]` | `GET …/{kn}` | `--stats`→`?include_statistics=true`; `--export`→`?mode=export`. |
| `stats <kn-id>` | same as `get --stats` | Pure alias. |
| `export <kn-id>` | same as `get --export` | Pure alias. |
| `search <kn-id> <query>` | `POST agent-retrieval/.../semantic-search` | Semantic search. |
| `create <name>` | `POST …/knowledge-networks` | Empty KN; body `{name, branch, base_branch:""}`. |
| `update <kn-id>` | `PUT …/{kn}` | `--body`/`--body-file`. |
| `delete <kn-id>` | `DELETE …/{kn}` | `-y/--yes` accepted (no interactive prompt is wired — delete is immediate). |
| `subgraph <kn-id>` | `POST ontology-query/.../{kn}/subgraph` | `--body`/`--body-file`. |
| `object-type …` | ontology-manager + ontology-query | CRUD + `query`/`properties`. |
| `relation-type …` | ontology-manager | CRUD only. |
| `action-type …` | ontology-manager + ontology-query | `list`/`get`/`query`/`execute`/`inputs` (no create/update/delete). |
| `relation-type-paths <kn-id>` | `POST bkn-backend/.../{kn}/relation-type-paths` | `--body`/`--body-file`. |
| `metric …` | ontology-manager (defs) + ontology-query (data/dry-run) | Full CRUD + `query`/`dry-run`/`search`/`validate`. |
| `concept-group …` | bkn-backend | CRUD + `add-members`/`remove-members`. |
| `action-log …` | ontology-query | `list`/`get`/`cancel`. |
| `action-execution <kn-id> <execution-id>` | `GET ontology-query/.../action-executions/{id}` | Execution status. |
| `action-schedule …` | bkn-backend | `list`/`get`/`create`/`update`/`set-status`/`delete`. |
| `job …` | bkn-backend | `list`/`get`/`tasks`/`delete`. |
| `resources` | `GET bkn-backend/v1/resources` | Global BKN-backend resources (no `<kn-id>`). |
| `push <directory>` | `POST bkn-backend/v1/bkns` (multipart) | tar a dir → import. `--build` adds Vega build tasks. |
| `pull <kn-id> [directory]` | `GET bkn-backend/v1/bkns/{kn}` (tar) | Download + extract. dir defaults to `<kn-id>`. |
| `validate <directory>` | local only (no network) | Offline structural check; exit 1 if invalid. |
| `create-from-catalog <catalog-id>` | orchestration | Catalog tables → resources → KN → OTs [→ build]. |
| `create-from-csv <catalog-id>` | orchestration | CSV → catalog tables → create-from-catalog. |

---

## bkn list — list knowledge networks

`GET /api/ontology-manager/v1/knowledge-networks`

| Flag | Required | Default | Notes |
| --- | :---: | --- | --- |
| `--limit <n>` | no | `30` | Page size (`limit` query param). |
| `--offset <n>` | no | `0` | Page offset. |
| `--name-pattern <s>` | no | — | `name_pattern` filter (omitted when empty). |
| `--tag <s>` | no | — | `tag` filter (omitted when empty). |
| `--sort <field>` | no | `update_time` | Sort field. |
| `--direction <dir>` | no | `desc` | `asc` \| `desc`. |

```bash
openbkn bkn list
openbkn bkn list --name-pattern sales --limit 50 --sort update_time --direction desc
```

## bkn get / stats / export

`GET /api/ontology-manager/v1/knowledge-networks/{kn-id}`

| Flag | Required | Default | Notes |
| --- | :---: | --- | --- |
| `--stats` | no | off | Sets `?include_statistics=true`. `stats <kn-id>` is the alias. |
| `--export` | no | off | Sets `?mode=export` → full export payload (object/relation/action types inline). `export <kn-id>` is the alias. |

```bash
openbkn bkn get <kn-id>
openbkn bkn get <kn-id> --stats        # == openbkn bkn stats <kn-id>
openbkn bkn export <kn-id> --json > kn.json
```

## bkn search — semantic search

`POST /api/agent-retrieval/v1/kn/semantic-search`. Body:
`{ kn_id, query, mode, max_concepts, return_query_understanding:false }`.

| Flag | Required | Default | Notes |
| --- | :---: | --- | --- |
| `<kn-id>` | ✅ | — | Positional. |
| `<query>` | ✅ | — | Positional free-text query. |
| `--max-concepts <n>` | no | `10` | `max_concepts`. |
| `--mode <mode>` | no | `keyword_vector_retrieval` | Retrieval mode. Vector results require a **built index** on the object type's resource — without it you get keyword-only hits. |

```bash
openbkn bkn search <kn-id> "customers in California with overdue invoices"
openbkn bkn search <kn-id> "web pods" --max-concepts 25 --mode keyword_vector_retrieval
```

---

## Schema: object-type / relation-type / action-type

Three groups share a list/get/CRUD shape, but **capabilities differ**:

| Group | list | get | create | update | delete | extra |
| --- | :---: | :---: | :---: | :---: | :---: | --- |
| `object-type` | ✅ | ✅ | ✅ | ✅ | ✅ | `query`, `properties` |
| `relation-type` | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| `action-type` | ✅ | ✅ | ❌ | ❌ | ❌ | `query`, `execute`, `inputs` |

- `list <kn-id> [--branch main]` — `GET …/{kn}/{kind}` with `branch` + `limit=-1`.
- `get <kn-id> <id>` — `GET …/{kn}/{kind}/{id}`.
- `create <kn-id> --body|--body-file` — `POST …/{kn}/{kind}` (single item; body is
  the item object). NOTE: `create-from-catalog` uses a different **batch**
  endpoint internally (`{entries:[…]}`); the CLI `create` is single-item.
- `update <kn-id> <id> --body|--body-file` — `PUT …/{kn}/{kind}/{id}`.
- `delete <kn-id> <id>` — `DELETE …/{kn}/{kind}/{id}` (`-y/--yes` accepted, no prompt).

`{kind}` ∈ `object-types` | `relation-types` | `action-types`.

```bash
openbkn bkn object-type list <kn-id>
openbkn bkn object-type get <kn-id> <ot-id>
openbkn bkn object-type create <kn-id> --body-file customer-ot.json
openbkn bkn object-type update <kn-id> <ot-id> --body '{"display_name":"Customer"}'
openbkn bkn relation-type create <kn-id> --body-file owns-relation.json
```

### object-type query — instance query (high-traffic, error-prone)

`POST /api/ontology-query/v1/knowledge-networks/{kn}/object-types/{ot-id}`. Body is a
backend query object (passed through). For LLM use:

> **Strategy:** always pass a small `limit`; paginate with `search_after`; narrow with
> `condition`. Wide object types truncate JSON output otherwise.

```bash
openbkn bkn object-type query <kn-id> <ot-id> \
  --body '{"limit":20,"condition":{"field":"status","op":"eq","value":"active"}}'
# next page: feed the prior page's tail sort value(s) into search_after
openbkn bkn object-type query <kn-id> <ot-id> \
  --body '{"limit":20,"search_after":["<last-sort-value>"]}'
```

`object-type properties <kn-id> <ot-id>` — `GET …/object-types/{ot}/properties`,
the object type's calculated/derived properties (no body).

### action-type query / execute / inputs

- `inputs <kn-id> <at-id>` — `GET …/action-types/{at}/inputs`; **call this first** to
  learn the required input schema before `execute`.
- `query <kn-id> <at-id> --body|--body-file` — `POST …/action-types/{at}/` (trailing
  slash intentional).
- `execute <kn-id> <at-id> --body|--body-file` — `POST …/action-types/{at}/execute`;
  body is the execution envelope. Track the run via `action-log` / `action-execution`.

```bash
openbkn bkn action-type inputs <kn-id> <at-id>
openbkn bkn action-type execute <kn-id> <at-id> --body-file exec-envelope.json
```

---

## metric

Definitions live in ontology-manager; data + dry-run in ontology-query.

| Subcommand | Endpoint (method) | Body | Notes |
| --- | --- | :---: | --- |
| `list <kn-id>` | `GET …ontology-manager/.../metrics` | — | `branch=main`, `limit=-1`. |
| `get <kn-id> <metric-id>` | `GET …/metrics/{id}` | — | |
| `create <kn-id>` | `POST …/metrics` | ✅ | Metric definition. |
| `update <kn-id> <metric-id>` | `PUT …/metrics/{id}` | ✅ | |
| `delete <kn-id> <metric-id>` | `DELETE …/metrics/{id}` | — | No `-y` flag here. |
| `search <kn-id>` | `POST …/metrics/search` | ✅ | Search payload. |
| `validate <kn-id>` | `POST …/metrics/validate` | ✅ | Validate a definition (no write). |
| `query <kn-id> <metric-id>` | `POST …ontology-query/.../metrics/{id}/data` | ✅ | Run the metric → data. |
| `dry-run <kn-id>` | `POST …ontology-query/.../metrics/dry-run` | ✅ | Try a definition **without** creating it; safest pre-flight. |

```bash
openbkn bkn metric list <kn-id>
openbkn bkn metric dry-run <kn-id> --body-file metric-def.json     # validate by running
openbkn bkn metric create <kn-id> --body-file metric-def.json
openbkn bkn metric query <kn-id> <metric-id> --body '{"filters":{"region":"APAC"}}'
```

> `dry-run` (run a definition, no persistence) and `validate` (static check) are
> different: dry-run actually computes; validate only checks the definition shape.

---

## concept-group

`bkn-backend` `…/{kn}/concept-groups`. CRUD plus membership.

| Subcommand | Endpoint (method) | Notes |
| --- | --- | --- |
| `list <kn-id>` | `GET …/concept-groups` | |
| `get <kn-id> <cg-id>` | `GET …/concept-groups/{cg}` | |
| `create <kn-id>` | `POST …/concept-groups` | `--body`/`--body-file`. |
| `update <kn-id> <cg-id>` | `PUT …/concept-groups/{cg}` | `--body`/`--body-file`. |
| `delete <kn-id> <cg-id>` | `DELETE …/concept-groups/{cg}` | |
| `add-members <kn-id> <cg-id>` | `POST …/concept-groups/{cg}/object-types` | Body = object types to add. |
| `remove-members <kn-id> <cg-id> <ot-ids>` | `DELETE …/concept-groups/{cg}/object-types/{ot-ids}` | `<ot-ids>` is a **comma-joined** id string (positional, no flag, not URL-encoded). |

```bash
openbkn bkn concept-group add-members <kn-id> <cg-id> --body '{"object_type_ids":["a","b"]}'
openbkn bkn concept-group remove-members <kn-id> <cg-id> a,b,c
```

## action-log / action-execution

| Subcommand | Endpoint (method) | Notes |
| --- | --- | --- |
| `action-log list <kn-id>` | `GET ontology-query/.../action-logs` | `--status`, `--action-type-id`, `--limit` (default `30`). |
| `action-log get <kn-id> <log-id>` | `GET …/action-logs/{log}` | |
| `action-log cancel <kn-id> <log-id>` | `POST …/action-logs/{log}/cancel` | Cancel a running action. |
| `action-execution <kn-id> <execution-id>` | `GET …/action-executions/{id}` | Execution status (note: separate from action-log). |

```bash
openbkn bkn action-log list <kn-id> --status running --limit 50
openbkn bkn action-log cancel <kn-id> <log-id>
```

## action-schedule

`bkn-backend` `…/{kn}/action-schedules`.

| Subcommand | Endpoint (method) | Notes |
| --- | --- | --- |
| `list <kn-id>` | `GET …/action-schedules` | |
| `get <kn-id> <schedule-id>` | `GET …/action-schedules/{id}` | |
| `create <kn-id>` | `POST …/action-schedules` | `--body`/`--body-file`. |
| `update <kn-id> <schedule-id>` | `PUT …/action-schedules/{id}` | `--body`/`--body-file`. |
| `set-status <kn-id> <schedule-id>` | `PUT …/action-schedules/{id}/status` | `--body`/`--body-file` (e.g. enable/disable). |
| `delete <kn-id> <schedule-ids>` | `DELETE …/action-schedules/{ids}` | `<schedule-ids>` comma-joined positional. |

## job — build jobs

`bkn-backend` `…/{kn}/jobs`. Read + delete only (jobs are created by builds).

| Subcommand | Endpoint (method) | Notes |
| --- | --- | --- |
| `list <kn-id>` | `GET …/jobs` | |
| `get <kn-id> <job-id>` | `GET …/jobs/{job}` | |
| `tasks <kn-id> <job-id>` | `GET …/jobs/{job}/tasks` | Per-task progress. |
| `delete <kn-id> <job-ids>` | `DELETE …/jobs/{ids}` | comma-joined positional. |

## resources / relation-type-paths

- `bkn resources` — `GET /api/bkn-backend/v1/resources`; **global**, takes no
  `<kn-id>`. (For Vega resources used by build, use top-level `resource`/`vega`.)
- `bkn relation-type-paths <kn-id> --body|--body-file` —
  `POST bkn-backend/.../{kn}/relation-type-paths`; finds relation paths between
  object types (body carries the source/target object-type ids + hop limits).

---

## push — pack a local BKN dir and import it

`POST /api/bkn-backend/v1/bkns?branch=<branch>` as multipart `file` (a tar of the
directory). Returns the created KN id/status. With `--build`, also walks the dir's
object types and submits one **Vega BuildTask per object type that declares a
`vector` index**, then returns `{ …upload, build_tasks:[{objectType,resourceId,taskId}] }`.

| Flag | Required | Default | Notes |
| --- | :---: | --- | --- |
| `<directory>` | ✅ | — | Local BKN dir (must contain `network.bkn`; see `validate`). |
| `--branch <name>` | no | `main` | Target branch. |
| `--build` | no | off | Submit a Vega build task per object type declaring a `vector` index. |
| `--embedding-model <id>` | no | — | Fallback embedding model for declared vectors (only with `--build`; a per-property `vector(<model>)` wins over it). |

**What `--build` reads from each `object_types/*.bkn`** (see `src/utils/bkn-index.ts`):

| Source in the `.bkn` | Used for |
| --- | --- |
| `### Data Source` / `### 数据来源` table, first row with `type=resource` | the **resource id** to build. Unbound, or an unrendered `{{placeholder}}`, → object type **skipped**. |
| `### Property Overrides` / `### 属性覆盖` `索引配置`/`Index Config` cell containing `vector`, **or** an `索引`/`Index` column on `### Data Properties` saying `vector` | which properties to vectorize. A bare `YES` (no `vector`) is **ignored**. No vector props → skipped. |
| `vector(<model>)` inside that cell | per-property embedding model (overrides `--embedding-model`). |
| `### Data Properties` `mapped field`/`映射字段` column | maps property name → resource column → `embedding_fields`. |
| `Incremental Key:` (preferred) else `Primary Key:` / `主键` | `build_key_fields` (build is `mode:batch`). |

```bash
openbkn bkn validate ./my-kn          # always validate first
openbkn bkn push ./my-kn
openbkn bkn push ./my-kn --branch main --build --embedding-model <model-id>
```

## pull — download + extract a KN

`GET /api/bkn-backend/v1/bkns/{kn-id}?branch=<branch>` → tar bytes, extracted into
`[directory]`.

| Flag / arg | Required | Default | Notes |
| --- | :---: | --- | --- |
| `<kn-id>` | ✅ | — | |
| `[directory]` | no | `<kn-id>` | Created if missing. Returns `{knId, dir, bytes}`. |
| `--branch <name>` | no | `main` | Source branch. |

```bash
openbkn bkn pull <kn-id>              # → ./<kn-id>/
openbkn bkn pull <kn-id> ./out --branch main
```

## validate — offline structural check

Local, **no network**. Parses frontmatter of every `.bkn`. Returns
`{valid, dir, counts:{objectTypes,relationTypes,conceptGroups}, errors[], warnings[]}`
and **exits 1** when `valid:false`. Checks:

- `network.bkn` exists at root, has frontmatter, `type: knowledge_network`, and an
  `id` + `name`.
- Each `object_types/*.bkn`: `type: object_type`, has `id` + `name`, name ≤ **40
  codepoints** (`BKN_OBJECT_NAME_MAX_LENGTH`), ids unique (duplicates = error).
- Each `relation_types/*.bkn`: `type: relation_type`, has `id`; endpoint
  `source`/`target` ids that don't resolve to a known object type → **warning**
  (not an error).

```bash
openbkn bkn validate ./my-kn
openbkn bkn validate ./my-kn --json | jq '.errors'
```

---

## create-from-catalog — build a KN from catalog tables (high-traffic)

Orchestration (`src/resources/bkn-create.ts`):

1. list catalog tables (`category=table`); if empty, `discoverCatalog` once, re-list.
2. introspect columns + resolve **one PK per table** (see PK detection) — **fail-fast
   before any side effects**.
3. create a Vega resource per table (idempotent via exact-name find).
4. create the KN, then **batch-create** object types (`{entries:[…]}`, all-or-nothing).
5. optional `--build`: one Vega BuildTask per resource (`mode:batch`,
   `build_key_fields=[pk]`).

Any failure **after** the KN is created rolls the KN back (cascades to OTs) unless
`--no-rollback`. Progress lines go to **stderr**; the JSON result is on stdout.

| Flag | Required | Default | Notes |
| --- | :---: | --- | --- |
| `<catalog-id>` | ✅ | — | Vega catalog id (positional). |
| `--name <name>` | ✅ | — | KN name. |
| `--tables <list>` | no | all tables | Comma-separated table names; others ignored. |
| `--pk-map <map>` | no | auto-detect | `'<table>:<col>[,<table>:<col>…]'`. Overrides detection. References to unknown tables/columns → error. |
| `--build` | no | off | Submit a Vega build task per resource after creation. |
| `--embedding-fields <map>` | no | — | `'<table>:<col>[+<col>…][,…]'` — columns to vectorize per table (only meaningful with `--build`). |
| `--embedding-model <id>` | no | — | Embedding model for the vector index (with `--build`). |
| `--no-rollback` | no | rollback on | Keep a partially-created KN on later failure (default = delete it). |

```bash
# All tables, auto PK
openbkn bkn create-from-catalog <catalog-id> --name "Sales KN"
# Subset + explicit PKs + build a vector index on two columns
openbkn bkn create-from-catalog <catalog-id> --name "Sales KN" \
  --tables customers,orders \
  --pk-map customers:customer_id,orders:order_id \
  --build --embedding-fields customers:name+notes --embedding-model <model-id>
```

## create-from-csv — import CSVs, then build a KN

Phase 1: import each CSV into the catalog as a table via a one-shot dataflow DAG
(first batch creates, later batches append); keeps a ≤100-row sample per table for PK
detection. Phase 2: delegates to `create-from-catalog` on the imported tables. Result
adds `imported_tables` + `failed_imports`. If zero tables import → error.

Adds these over create-from-catalog (rest are identical):

| Flag | Required | Default | Notes |
| --- | :---: | --- | --- |
| `<catalog-id>` | ✅ | — | Target catalog to import into. |
| `--files <glob>` | ✅ | — | CSV paths: comma-separated and/or glob. |
| `--name <name>` | ✅ | — | KN name. |
| `--table-prefix <s>` | no | `""` | Prefix for derived table names. |
| `--batch-size <n>` | no | `500` | Rows per insert batch. |
| `--tables <list>` | no | all imported | Subset of imported tables to put in the KN. |

```bash
openbkn bkn create-from-csv <catalog-id> --files './data/*.csv' --name "Imported KN"
openbkn bkn create-from-csv <catalog-id> --files a.csv,b.csv --name "KN" \
  --table-prefix raw_ --batch-size 1000 --build --embedding-fields a:title
```

---

## PK detection (create-from-* commands)

`src/utils/pk-detection.ts`. One key per object type is required; getting it wrong
silently drops rows, so resolution is deliberate and **fails loudly** rather than
guessing:

1. `--pk-map <table>:<col>` override (validated against real columns).
2. schema-declared **single** PK from datasource metadata.
3. sample-cardinality detection: a column unique across the sample, preferring names
   matching `id` / `*_id` / `*_pk` (`PK_NAME_HINTS`).

A **composite** schema PK is reported `ambiguous` → error telling you to pick one with
`--pk-map <table>:<column>`. If no column is unique in the sample → error listing the
top-5 candidates by cardinality. **Display key** auto-picks the first column whose name
contains `name`/`title`/`label`/`display_name`/`description`, else falls back to the PK.

---

## Index build is NOT automatic

`push` / `create-from-*` (without `--build`) and the backend `CreateKN` **never** build
an OpenSearch/vector index. The index lives on the **Vega resource**, one resource per
table. Build it via:

- `bkn push <dir> --build` — reads each object type's `vector` declaration + `### Data
  Source` resource binding (see the push table) and submits one batch BuildTask per
  resource.
- `bkn create-from-catalog … --build --embedding-fields <table>:<col>` — build during
  KN creation.
- Manual: `vega dataset build <resource-id>`.

See [vega.md](vega.md).

---

## Gotchas → fix

| Symptom | Cause / Fix |
| --- | --- |
| `Provide --body '<json>' or --body-file <path>.` | A write/query subcommand needs a body; pass one of them. |
| `Request body is not valid JSON.` | `--body` value isn't valid JSON (shell-quoting). Prefer `--body-file`. |
| `--pk-map references unknown table '<t>'.` / `… is not a column.` | Table not in the catalog/`--tables` set, or column name wrong. Check `vega catalog resources <catalog>` and the table's columns. |
| `Table '<t>' has a composite primary key (…). BKN object types take one key` | Composite PK; disambiguate with `--pk-map <t>:<column>`. |
| `Cannot auto-detect a primary key for table '<t>'.` | No unique column in the ≤100-row sample. Pass `--pk-map <t>:<column>`. |
| `No tables available in catalog after scan.` / `No matching tables to build from.` | Catalog has no tables (discover failed) or `--tables` matched nothing. |
| Semantic `search` returns only keyword hits | Vector index not built on the resource — run a build (`push --build` / `vega dataset build`). |
| `push` succeeds but `build_tasks` is empty | Object types declare no `vector` index, or the `### Data Source` id is an unrendered `{{placeholder}}` → skipped. Check `### Property Overrides` / `### Data Source` in the `.bkn`. |
| `validate` exits 1 | Read `errors[]`: missing `network.bkn`, wrong frontmatter `type`, missing `id`/`name`, name > 40 codepoints, or duplicate object-type id. Endpoint ref problems are warnings, not failures. |
| `object-type query` JSON truncated | Wide table — add a small `limit` and paginate via `search_after`; filter with `condition`. |
| TLS / self-signed errors against a dev cluster | `-k`/`--insecure` (dev only). |
