# vega — catalog + index build

| Command | Notes |
|---------|-------|
| `catalog list [--limit] [--offset]` / `catalog get <id>` | Catalogs. |
| `catalog resources <id> [--category table]` | Resources under a catalog. |
| `catalog health <ids...>` | Health-status for one or more catalogs. |
| `connector-type list` / `connector-type get <type>` | Available connector types. |
| `sql --resource-type <t> --query "<sql>"` / `sql -d <json>` | Run SQL (MySQL/MariaDB/PostgreSQL) or OpenSearch DSL directly against a data source. Table = `{{<resource-id>}}`; `--resource-type` **required**. See [§ vega sql](#vega-sql--run-sql--dsl-against-a-data-source). |
| `resource …` | Vega-backend resources (mirror of top-level `resource`). |
| `dataset build <resource-id> --mode batch\|streaming [--embedding-fields a,b] [--build-key-fields k] [--embedding-model <id>] [--model-dimensions <n>] [--wait]` | Create an index BuildTask. **Index build lives on the resource (one resource = one table); there is no KN-level build.** `batch` requires `--build-key-fields` (else `400 build_key_fields is required for batch mode`). |
| `dataset build-status <resource-id> <task-id>` | BuildTask state + progress. |

## `vega sql` — run SQL / DSL against a data source

`POST /api/vega-backend/v1/resources/query`. vega-backend connects **directly**
to the data source (no Trino): SQL on MySQL/MariaDB/PostgreSQL, DSL on
OpenSearch. Dialect translation is done server-side with sqlglot.

### The placeholder rule (most important)

In the `FROM`, reference the table as a **Vega resource id** wrapped in
`{{ }}` — `{{<resource-id>}}` or `{{.<resource-id>}}`, both accepted. This is
how the backend knows **which Catalog connector** to open. The id is a Vega
resource id (looks like `d7nicrcjto2s73d9g67g`), **not** the physical table
name. Get it with:

```bash
openbkn resource find --name <table> --exact     # → resource id
openbkn resource get <resource-id>               # confirm it
```

Bare table names (no placeholder) usually fail with
`connector config is incomplete` — the backend falls back to a global default
connector that isn't configured. **Always use the placeholder.**

### `--resource-type` is REQUIRED

vega-backend does **not** infer the type — omitting it returns
`400 VegaBackend.InvalidParameter.ResourceType` (verified live). Find a
resource's type via its catalog:

```bash
openbkn resource get <resource-id> --json     # → catalog_id
openbkn vega catalog get <catalog-id> --json  # → connector_type (e.g. "mysql")
```

(The KN-scoped MCP `run_sql` tool *does* auto-resolve the type — see
[context.md](context.md). `vega sql` does not.)

### Usage — verified against the Fjelstul World Cup catalog (mysql)

```bash
# Simple SELECT (resource id d8sl8edr563s73afv2s0 = worldcup.wc_tournaments)
openbkn vega sql --resource-type mysql \
  --query "SELECT * FROM {{d8sl8edr563s73afv2s0}} LIMIT 3"
# → tournament_id  tournament_name            year  …
#   WC-1930        1930 FIFA Men's World Cup  1930  …

# WHERE / projection (standard SQL, the source's dialect)
openbkn vega sql --resource-type mysql \
  --query "SELECT tournament_name, year FROM {{<res-id>}} WHERE year >= 2000 ORDER BY year DESC LIMIT 20"

# OpenSearch DSL — query is a JSON object, not a SQL string → use --data
openbkn vega sql -d '{"query":{"match":{"name":"web-pod"}},"resource_type":"opensearch"}'

# Advanced — full body
openbkn vega sql -d '{"query":"SELECT ...","resource_type":"mysql","stream_size":1000,"query_timeout":120}'
```

### Parameters

| Flag / field | Required | Default | Notes |
| --- | :---: | --- | --- |
| `--query` / body `query` | ✅ (unless `-d` carries it) | — | SQL string, **or** an OpenSearch DSL object (object → must use `-d`). Reference the table as `{{<resource-id>}}`. |
| `--resource-type` / `resource_type` | ✅ | — | One of `vega connector-type list`: `mysql`, `mariadb`, `postgresql`, `opensearch`. **Required** — not inferred. |
| `--stream-size` / `stream_size` | optional | server default (≈10000) | Streaming batch size, 100–10000. |
| `--query-timeout` / `query_timeout` | optional | 60 | Seconds, 1–3600. |
| `query_id` (body only) | optional | — | Cursor session id for paged streaming. |
| `-d` / `--data` | — | — | Full JSON body. **Wins over** `--query`/`--resource-type`/etc. when both given. |

### `vega sql` vs `context … run_sql`

Two different SQL paths — don't confuse them:

| | `vega sql` | `context tool-call <kn> run_sql` |
| --- | --- | --- |
| Backend | vega-backend `/resources/query` | MCP `run_sql` tool (KN-scoped) |
| Dialect | source-native (mysql/pg), sqlglot-translated | **Trino** |
| `resource_type` | **required** | optional (auto-resolved) |
| Placeholder | `{{<resource-id>}}` | `{{.<resource-id>}}` (**leading dot**), id = object type's `data_source.id` |
| Limits | `--stream-size` (≤10000) | SELECT/WITH only, ≤10000 rows, no cross-catalog join |

### Gotchas

- **Always `LIMIT`** large tables — results stream back in full otherwise.
- SQL dialect is the **source's** (MySQL vs PostgreSQL quoting/functions differ);
  sqlglot translates common forms but not everything.
- The data source must already be a registered **Catalog + Resource** (see
  below) — `vega sql` queries an existing resource, it doesn't create one.
- `connector config is incomplete` → missing/incorrect `{{<resource-id>}}`
  placeholder, or the resource's catalog connector isn't healthy
  (`vega catalog health <id>`).

## catalog → resource → index

A **catalog** is a container (`physical` = real data source via a connector; `logical` = internal namespace). A **resource** is one table/dataset inside it (`resource.catalog_id` → its catalog). The OpenSearch/vector index is built **per resource**, on the field(s) you pass to `--embedding-fields`. The MySQL/connector binding itself is registered platform-side — the CLI reads + discovers catalogs and builds resources, it does not create the data-source connection.

Build a `name` field on a MySQL table:

```bash
openbkn resource find --name <table> --exact          # → resource_id
openbkn vega dataset build <resource-id> --mode batch \
  --embedding-fields name --build-key-fields <pk-or-time-col> [--embedding-model <id>] --wait
```

## index is NOT auto-built on `bkn push`

`bkn push` / backend `CreateKN` never submits a build-task. To build declared vector fields, either:

- `bkn push <dir> --build` — reads each object type's `vector` index declaration (`### Property Overrides` / `属性覆盖`, or an `索引`/`Index` column) + its `### Data Source` resource binding, and submits one BuildTask per resource. See [bkn.md](bkn.md).
- `bkn create-from-catalog … --build --embedding-fields <table>:<col>` — build during KN creation.
- Manual: `vega dataset build <resource-id>`.

Catalog ids are short slugs (e.g. `d7nicrcjto2s73d9g67g`), not data-connection UUIDs. `discover` only works on physical catalogs.
