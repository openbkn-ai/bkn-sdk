# vega — catalog + index build

| Command | Notes |
|---------|-------|
| `catalog list [--name] [--tag] [--type physical\|logical] [--connector-type] [--enabled true\|false] [--health-check-status healthy\|degraded\|unhealthy\|offline\|unchecked] [--sort name\|create_time\|update_time] [--direction asc\|desc] [--limit] [--offset]` / `catalog get <id>` | Catalogs. Enum and boolean flags are checked before any request. |
| `catalog create --name <s> --connector-type <t> --connector-config <json> [--enabled]` / `catalog create --name <s> --internal` | Physical catalogs need a connector; `--internal` creates a logical catalog and takes no connector flags. `enabled` is always sent (`false` unless `--enabled`). |
| `catalog update <id> [--name] [--tags] [--description] [--connector-type] [--connector-config <json>] [--expected-update-time <ms>]` | Reads the catalog, then sends the full PUT with your fields laid over it — fields you omit keep their values. The lock version defaults to the `update_time` just read. `enabled` cannot change here; use `catalog enable\|disable <id>`. |
| `catalog test-connection <id>` / `catalog test-connection-config --connector-type <t> --connector-config <json>` / `catalog health-check-schedule\|set-health-check-schedule <id>` | Connection probes and the health-check schedule. |
| `catalog stats [--name <s>]` | Count visible catalogs by catalog type and connector type. |
| `catalog resources <id> [--category table] [--limit n] [--offset n]` | Resources under a catalog. The SDK defaults to 30. To read them all, page with `--offset` until `total_count` — the `/resources` contract documents no `-1` and no maximum page size. |
| `catalog delete <id> [--dry-run]` | Preview deletion impact with `--dry-run`; omit it to delete. Running tasks and protected resources block deletion. |
| `catalog health <id>` | Health status for one catalog (one id per call). |
| `catalog discover <id> [--strategy full_sync\|create_only\|cleanup_only]` | Start asynchronous resource discovery; returns a discovery-task id. |
| `vega resource discover <id>` / `vega resource enable\|disable <id>` | Refresh one Resource's metadata, or change its enabled state without changing discovery status. |
| `discover-schedule create\|list\|get\|update\|delete\|enable\|disable` | Manage catalog discovery schedules. Update is a full replacement and requires the current state plus `--expected-update-time`. |
| `discover-task list [--resource-id <id>]\|get\|delete` | Inspect or clean up discovery-task history. Task `queue_priority` is output-only; it cannot be used to sort or reprioritize tasks. |
| `semantic-task create\|list\|get\|delete` | Manage semantic-understanding tasks. |
| `connector-type list [filters]` / `connector-type get <type>` | Read connector types. Registration and mutation are intentionally not exposed. |
| `index-capabilities` | Read the local index's fulltext analyzers and probe timestamp. **Undocumented deploy extension** — not in the vega-backend contract; deployments without it answer 404. |
| `sql --query "<sql>"` / `sql -d <json>` | Run SQL or OpenSearch DSL directly against a data source. SQL uses a `{{<resource-id>}}` table placeholder; DSL identifies its resource with top-level `resource_id`. See [§ vega sql](#vega-sql--run-sql--dsl-against-a-data-source). |
| `resource list [--type <category>] [--status active\|deprecated\|stale] [--sort] [--direction]\|get\|create\|update\|delete` | Manage Vega-backend resources. Categories: `table`, `file`, `fileset`, `api`, `metric`, `topic`, `index`, `logicview`, `dataset`. Index configuration is saved with `resource update --schema-definition <json> --index-config <json>`; a vector feature's read-only `config.dimension` is stripped before the PUT. |
| `resource query <id> [--filter <json>] [--sort f:desc,g] [--output-fields a,b] [--limit] [--offset] [--paging-mode single\|cursor] [--keep-alive-sec 60-3600] [--need-total] [--binary-mode metadata\|content] [--ignore-local-index]` / `resource query <id> --cursor <c>` | Read rows through the resource (default limit 50). The response's `query_source` says whether the table's `local_index` or its `source` answered. A cursor continuation takes no other query flags. |
| `vega resource document-create\|document-get\|document-upsert\|document-delete\|document-delete-filter` | Manage documents for a dataset resource. A document's id key is `_id`; `document-create` must not carry it (use `document-upsert` for a known id). Delete-by-filter requires a non-empty filter. |
| `resource build <resource-id> [--execute-type incremental\|full] [--wait] [--timeout <s>]` | Create a batch index BuildTask from the Resource's already-saved schema and index configuration. It does not update the Resource. With `--wait`, progress appears on stderr and failed/stopped/timed-out tasks exit non-zero. |
| `build-task get <task-id> [--wait] [--timeout <s>]` / `build-task list [--status pending,running] [--mode batch\|streaming]` | Read BuildTask status and progress. `--wait` follows an existing task until its `status` is `completed`, `failed`, `stopped`, or `cancelled`; `--timeout 0` waits without a polling deadline. Multiple statuses are OR filters. |
| `build-task start <task-id> [--reset]` / `build-task stop <task-id>` / `build-task delete <ids...>` | Manage the BuildTask lifecycle. |

## `vega sql` — run SQL / DSL against a data source

`POST /api/vega-backend/v1/resources/query`. The query body declares its
representation with `query_format` and its input syntax with `input_dialect`;
the backend resolves the actual data source through the referenced Resource.

### The placeholder rule (most important)

In the `FROM`, reference the table as a **Vega resource id** wrapped in
`{{ }}` — `{{<resource-id>}}`, the form the contract documents. This is
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
| `--input-dialect` / `input_dialect` | SQL optional; DSL required | SQL: `postgres` | SQL supports `postgres`, `mysql`, `trino`, `duckdb`, or `tsql` (SQL Server; other dialects are converted to T-SQL for a SQL Server catalog); DSL must be `opensearch`. |
| `--paging-mode`, `--limit`, `--offset`, `--keep-alive-sec` / `paging` | optional | `single`, server-default limit | `cursor` requires `limit`; keep-alive is 60–3600 seconds. Always set `--limit` rather than relying on the server default. |
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

A **catalog** is a container (`physical` = real data source via a connector; `logical` = internal namespace). A **resource** is one table/dataset inside it (`resource.catalog_id` → its catalog). OpenSearch/vector indexes are built **per resource**. Feature declarations live in `schema_definition`, while defaults and key fields live in `index_config`; both are Resource configuration. The MySQL/connector binding itself is registered platform-side.

Save the schema/features and index configuration, then build:

```bash
openbkn resource find --name <table> --exact          # → resource_id
openbkn vega resource update <resource-id> \
  --schema-definition '<schema-json>' --index-config '<index-config-json>'
openbkn vega resource build <resource-id> --execute-type full --wait
```

`--schema-definition` replaces the complete field list; it does not merge individual
fields. Run `openbkn --json vega resource get <resource-id>` first, copy the complete
array from `entries[0].schema_definition`, and edit only the required features before
updating.

## Index build belongs to Vega

`bkn push` and `bkn create-from-catalog` only create or import knowledge-network metadata. Save index configuration through `vega resource update`, then create BuildTasks through `vega resource build`; inspect them through `vega build-task`.

Catalog ids are short slugs (e.g. `d7nicrcjto2s73d9g67g`), not data-connection UUIDs. `discover` only works on physical catalogs.
