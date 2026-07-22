# vega — catalog + index build

| Command | Notes |
|---------|-------|
| `catalog list [--limit] [--offset]` / `catalog get <id>` | Catalogs. |
| `catalog resources <id> [--category table] [--limit n] [--offset n]` | Resources under a catalog. Backend defaults to 20; `--limit -1` fetches all. |
| `catalog health <ids...>` | Health-status for one or more catalogs. |
| `connector-type list` / `connector-type get <type>` | Available connector types. |
| `sql --query "<sql>"` / `sql -d <json>` | Run SQL (MySQL/MariaDB/PostgreSQL) or OpenSearch DSL directly against a data source. Table = `{{<resource-id>}}`; `--resource-type` optional. See [§ vega sql](#vega-sql--run-sql--dsl-against-a-data-source). |
| `resource …` | Vega-backend resources (mirror of top-level `resource`). |
| `dataset build <resource-id> --mode batch\|streaming [--embedding-fields a,b] [--build-key-fields k] [--embedding-model <id>] [--fulltext-fields a,b] [--fulltext-analyzer <n>] [--execute-type incremental\|full] [--wait] [--timeout <s>]` | Create an index BuildTask. **Index build lives on the resource (one resource = one table); there is no KN-level build.** `batch` requires `--build-key-fields` (else `400 build_key_fields is required for batch mode`). |
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

### Usage

```bash
# Simple — only --query is required; resource_type is inferred from the placeholder
openbkn vega sql --query "SELECT * FROM {{d7nicrcjto2s73d9g67g}} LIMIT 10"

# With a WHERE / projection (standard SQL, the source's dialect)
openbkn vega sql --query "SELECT id, name FROM {{<res-id>}} WHERE status = 'active' ORDER BY id DESC LIMIT 50"

# Override the inferred type, larger stream batch
openbkn vega sql --resource-type postgresql --stream-size 5000 \
  --query "SELECT count(*) FROM {{<res-id>}}"

# OpenSearch DSL — query is a JSON object, not a SQL string → use --data
openbkn vega sql -d '{"query":{"match":{"name":"web-pod"}},"resource_type":"opensearch"}'

# Advanced — full body (any field below)
openbkn vega sql -d '{"query":"SELECT ...","stream_size":1000,"query_timeout":120}'
```

### Parameters

| Flag / field | Required | Default | Notes |
| --- | :---: | --- | --- |
| `--query` / body `query` | ✅ (unless `-d` carries it) | — | SQL string, **or** an OpenSearch DSL object (object → must use `-d`). Reference the table as `{{<resource-id>}}`. |
| `--resource-type` / `resource_type` | optional | inferred from the placeholder's catalog connector | One of `vega connector-type list` (e.g. `mysql`, `mariadb`, `postgresql`, `opensearch`). Pass only to override. |
| `--stream-size` / `stream_size` | optional | server default (≈10000) | Streaming batch size, 100–10000. |
| `--query-timeout` / `query_timeout` | optional | 60 | Seconds, 1–3600. |
| `query_id` (body only) | optional | — | Cursor session id for paged streaming. |
| `-d` / `--data` | — | — | Full JSON body. **Wins over** `--query`/`--resource-type`/etc. when both given. |

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
