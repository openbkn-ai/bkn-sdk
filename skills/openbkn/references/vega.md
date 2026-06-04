# vega — catalog + index build

| Command | Notes |
|---------|-------|
| `catalog list [--limit] [--offset]` / `catalog get <id>` | Catalogs. |
| `catalog resources <id> [--category table]` | Resources under a catalog. |
| `connector-types` | Available connector types. |
| `build --resource-id <r> --mode batch [--build-key-fields a,b] [--embedding-fields …]` | Create an index BuildTask (index build lives on the resource/catalog — there is no KN-level build). |
| build-task status | `vega build-task <taskId>` / via the returned task id. |

Catalog ids are short slugs (e.g. `d7nicrcjto2s73d9g67g`), not data-connection UUIDs. `discover` only works on physical catalogs.
