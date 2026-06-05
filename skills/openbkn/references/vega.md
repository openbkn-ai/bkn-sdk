# vega — catalog + index build

| Command | Notes |
|---------|-------|
| `catalog list [--limit] [--offset]` / `catalog get <id>` | Catalogs. |
| `catalog resources <id> [--category table]` | Resources under a catalog. |
| `catalog health <ids...>` | Health-status for one or more catalogs. |
| `connector-type list` / `connector-type get <type>` | Available connector types. |
| `resource …` | Vega-backend resources (mirror of top-level `resource`). |
| `dataset build <resource-id> --mode batch\|streaming [--embedding-fields a,b] [--build-key-fields k] [--embedding-model <id>] [--model-dimensions <n>] [--wait]` | Create an index BuildTask. **Index build lives on the resource (one resource = one table); there is no KN-level build.** `batch` requires `--build-key-fields` (else `400 build_key_fields is required for batch mode`). |
| `dataset build-status <resource-id> <task-id>` | BuildTask state + progress. |

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
