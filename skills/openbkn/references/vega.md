# vega — catalog + index build

| Command | Notes |
|---------|-------|
| `catalog list [--limit] [--offset]` / `catalog get <id>` | Catalogs. |
| `catalog resources <id> [--category table] [--limit n] [--offset n]` | Resources under a catalog. Backend defaults to 20; `--limit -1` fetches all. |
| `catalog health <ids...>` | Health-status for one or more catalogs. |
| `connector-type list` / `connector-type get <type>` | Available connector types. |
| `sql --query "<sql>"` / `sql -d <json>` | Run SQL or OpenSearch DSL directly against a data source. SQL uses a `{{<resource-id>}}` table placeholder; DSL identifies its resource with top-level `resource_id`. See [§ vega sql](#vega-sql--run-sql--dsl-against-a-data-source). |
| `resource …` | Vega-backend resources (mirror of top-level `resource`). |
| `dataset build <resource-id> --mode batch\|streaming [--embedding-fields a,b] [--build-key-fields k] [--embedding-model <id>] [--fulltext-fields a,b] [--fulltext-analyzer <n>] [--execute-type incremental\|full] [--wait] [--timeout <s>]` | Create an index BuildTask. **Index build lives on the resource (one resource = one table); there is no KN-level build.** `batch` requires `--build-key-fields` (else `400 build_key_fields is required for batch mode`). |
| `dataset build-status <resource-id> <task-id>` | BuildTask state + progress. |

## `vega sql` — run SQL / DSL against a data source

`POST /api/vega-backend/v1/resources/query`. The query body declares its
representation with `query_format` and its input syntax with `input_dialect`;
the backend resolves the actual data source through the referenced Resource.

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
# SQL; query_format=sql is added by the CLI. input_dialect defaults to postgres.
openbkn vega sql --query "SELECT * FROM {{d7nicrcjto2s73d9g67g}} LIMIT 10"

# First cursor page. Use a deterministic ORDER BY with a unique tiebreaker.
openbkn vega sql --input-dialect mysql --paging-mode cursor --limit 500 \
  --query "SELECT id, name FROM {{<res-id>}} ORDER BY id"

# Cursor continuation — send no initial-query options.
openbkn vega sql --cursor "<paging.next_cursor>"

# OpenSearch DSL — query is a JSON object; a top-level resource_id is required.
openbkn vega sql -d '{"query":{"resource_id":"<res-id>","query":{"match":{"name":"web-pod"}}},"query_format":"dsl","input_dialect":"opensearch","paging":{"mode":"single","limit":50}}'

# Advanced SQL body with total count and timeout.
openbkn vega sql -d '{"query":"SELECT ... FROM {{<res-id>}}","query_format":"sql","input_dialect":"postgres","paging":{"mode":"single","limit":1000},"query_timeout_sec":120,"need_total":true}'
```

### Parameters

| Flag / field | Required | Default | Notes |
| --- | :---: | --- | --- |
| `--query` / body `query` | ✅ for first page | — | SQL string or an OpenSearch DSL object. SQL references tables as `{{<resource-id>}}`; DSL includes top-level `resource_id`. |
| body `query_format` | ✅ for first page | — | `sql` or `dsl`; the CLI sets `sql` for `--query`. |
| `--input-dialect` / `input_dialect` | SQL optional; DSL required | SQL: `postgres` | SQL supports `postgres`, `mysql`, `trino`, or `duckdb`; DSL must be `opensearch`. |
| `--paging-mode`, `--limit`, `--offset`, `--keep-alive-sec` / `paging` | optional | `single`, limit 20 server-side | `cursor` requires `limit`; keep-alive is 60–3600 seconds. |
| `--cursor` / `paging.cursor` | continuation only | — | Opaque cursor from `paging.next_cursor`; no initial-query fields may accompany it. |
| `--query-timeout-sec` / `query_timeout_sec` | optional | 60 | Seconds, 1–3600; initial request only. |
| `--need-total` / `need_total` | optional | false | Include complete total count; frozen by the initial cursor request. |
| `-d` / `--data` | — | — | Full JSON body. Wins over the individual CLI query flags when both are given. |

### Gotchas

- Use `paging.limit` to bound every query. For cursor paging, include a stable,
  unique SQL ORDER BY tiebreaker to avoid duplicate or missing rows if source
  data changes.
- For OpenSearch cursor paging, the DSL must include a non-empty `sort`; the
  server owns `search_after` state inside the opaque cursor.
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
