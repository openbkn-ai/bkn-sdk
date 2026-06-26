# resource — vega-backend resources

Alias: `res`. A **resource** is one table / dataset / logic-view registered in
vega-backend, living under a **catalog** (the data-source container). This is the
top-level mirror of `vega resource` — same endpoints, same flags; use whichever
namespace you like. A resource id (short slug, e.g. `d7nicrcjto2s73d9g67g`) is the
unit that feeds:

- `vega sql` placeholders — `{{<resource-id>}}` in the `FROM`. See [vega.md § vega sql](vega.md#vega-sql--run-sql--dsl-against-a-data-source).
- `vega dataset build <resource-id>` — index/embedding build is **per resource**. See [vega.md](vega.md).
- BKN object-type binding — `data_source: { type: "resource", id }`.

All commands hit `/api/vega-backend/v1/resources`. The CLI **reads/queries/deletes**
resources; it does not create the underlying data-source connection (that is
registered platform-side via a catalog connector).

| Command | Notes |
| --- | --- |
| `list` | Browse resources, optionally scoped to one catalog/category. |
| `find --name <name>` | Search by name (fuzzy; `--exact` for strict). |
| `get <id>` | Full resource detail (schema, catalog_id, category). |
| `query <id>` | Fetch **data rows** with row-pagination (NOT SQL). |
| `delete <id>` | Delete a resource. |

## Conventions / non-obvious rules

- **`--datasource-id` is an alias of `--catalog-id`**, and **`--type` is an alias of
  `--category`** — "datasource" here means the **catalog id**, not a host/DSN. The id
  is a short slug from `vega catalog list`, not a UUID or a connector name.
- **`find` is not a server search.** It calls `list` with `name=<name>` then filters
  **client-side**: `--exact` keeps only `r.name === name`; without it you get the
  server's name-match list as-is. Empty result from `--exact` usually means a
  case/whitespace mismatch — drop `--exact` to see candidates.
- **`query` is row pagination, NOT SQL.** It returns raw rows via `--limit/--offset`
  only — no projection, no `WHERE`, no joins. For SQL/filtering use
  [`vega sql`](vega.md#vega-sql--run-sql--dsl-against-a-data-source) with a
  `{{<resource-id>}}` placeholder.
- **`get`/`query`/`delete` take a positional `<id>`**, not a `--name`. Resolve a name
  to an id with `find --exact` first.
- Output: global `--json` / `--compact` (machine) and `--full` (all columns) apply to
  every subcommand; the default human view truncates wide rows.

## list — browse resources

```bash
# Everything (first page, default 30)
openbkn resource list

# Scope to one catalog, tables only, bigger page
openbkn resource list --catalog-id d7nicrcjto2s73d9g67g --category table --limit 100
```

| Flag / field | Required | Default | Notes |
| --- | :---: | --- | --- |
| `--catalog-id <id>` | optional | — (all catalogs) | Catalog (data-source) slug from `vega catalog list`. Maps to query `catalog_id`. |
| `--datasource-id <id>` | optional | — | **Alias** of `--catalog-id`. If both given, `--catalog-id` wins. |
| `--category <c>` | optional | — (all) | One of `table` \| `logicview` \| `dataset`. Maps to query `category`. |
| `--type <c>` | optional | — | **Alias** of `--category`. `--category` wins if both set. |
| `--limit <n>` | optional | `30` | Page size; sent only when `> 0`. **No `--offset` on `list`** (use `find`/catalog scoping to narrow). |

## find — search by name

```bash
# Fuzzy: all resources whose name matches "orders"
openbkn resource find --name orders

# Exact + catalog-scoped → the one id to feed vega sql / dataset build
openbkn resource find --name orders --exact --catalog-id d7nicrcjto2s73d9g67g
```

| Flag / field | Required | Default | Notes |
| --- | :---: | --- | --- |
| `--name <name>` | ✅ | — | Name to search (`requiredOption`). Passed as `name` to the list endpoint. |
| `--exact` | optional | off (fuzzy) | Client-side filter to `name === <name>` (exact, case-sensitive). |
| `--catalog-id <id>` | optional | — | Limit to one catalog. |
| `--datasource-id <id>` | optional | — | **Alias** of `--catalog-id`. |

## get — resource detail

```bash
openbkn resource get d7nicrcjto2s73d9g67g
openbkn resource get d7nicrcjto2s73d9g67g --json   # full schema/fields
```

| Flag / field | Required | Default | Notes |
| --- | :---: | --- | --- |
| `<id>` (positional) | ✅ | — | Resource id slug. `GET /resources/<id>`. Returns schema, `catalog_id`, `category`, source identifier. |

## query — fetch data rows (row pagination, NOT SQL)

`POST /resources/<id>/data` with `{ limit, offset, need_total }`. Returns rows
straight off the source — no filtering/projection. For real querying, use
[`vega sql`](vega.md#vega-sql--run-sql--dsl-against-a-data-source).

```bash
# First 50 rows (defaults)
openbkn resource query d7nicrcjto2s73d9g67g

# Page 3 (rows 200–299) and include the total count
openbkn resource query d7nicrcjto2s73d9g67g --limit 100 --offset 200 --need-total
```

| Flag / field | Required | Default | Notes |
| --- | :---: | --- | --- |
| `<id>` (positional) | ✅ | — | Resource id. |
| `--limit <n>` | optional | `50` | Rows per response → body `limit`. |
| `--offset <n>` | optional | `0` | Starting row → body `offset`. |
| `--need-total` | optional | `false` | Include total row count → body `need_total: true`. Costs an extra `COUNT`; omit for speed. |

## delete — remove a resource

```bash
openbkn resource delete d7nicrcjto2s73d9g67g           # may prompt
openbkn resource delete d7nicrcjto2s73d9g67g --yes     # skip confirmation
```

| Flag / field | Required | Default | Notes |
| --- | :---: | --- | --- |
| `<id>` (positional) | ✅ | — | Resource id. `DELETE /resources/<id>`. |
| `-y, --yes` | optional | off | Skip the confirmation prompt (for scripts). |

## Typical flow: resource id → SQL / build

```bash
# 1. Find the resource id for a physical table
openbkn resource find --name orders --exact            # → d7nicrcjto2s73d9g67g

# 2a. Inspect rows (no SQL needed)
openbkn resource query d7nicrcjto2s73d9g67g --limit 5

# 2b. Real query — placeholder is the resource id, not the table name
openbkn vega sql --query "SELECT id, status FROM {{d7nicrcjto2s73d9g67g}} WHERE status='active' LIMIT 50"

# 2c. Build an embedding index on a field (per resource)
openbkn vega dataset build d7nicrcjto2s73d9g67g --mode batch \
  --embedding-fields name --build-key-fields id --wait
```

## Gotchas

- **`find` finds nothing with `--exact`?** It is case/whitespace-sensitive and
  client-side — run without `--exact` to list candidates, then copy the exact `name`.
- **Want to filter/aggregate rows?** `query` can't — it only paginates. Switch to
  [`vega sql`](vega.md#vega-sql--run-sql--dsl-against-a-data-source) with `{{<id>}}`.
- **`{{<resource-id>}}` vs table name:** `vega sql` placeholders use the **resource id**
  (this slug), never the physical table name — get it from `find`/`get` here.
- **No `create` subcommand on the CLI** — the SDK can `createResource`, but the
  `resource`/`res` command only lists/finds/gets/queries/deletes. Resources are
  normally registered by discovering a physical catalog (`vega` flow).
- **`--datasource-id` is a catalog id**, not a connection string — passing a host/DSN
  returns nothing.
- **`top-level resource` ≡ `vega resource`** — identical behaviour; don't expect extra
  flags on one vs the other.
