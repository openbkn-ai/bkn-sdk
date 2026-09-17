# resource — vega-backend resources

| Command | Notes |
|---------|-------|
| `list [--catalog-id <c>] [--category <c>] [--status active\|deprecated\|stale] [--sort name\|create_time\|update_time] [--direction asc\|desc] [--limit] [--offset]` | Browse. `--type` is an alias of `--category`; categories are `table`, `file`, `fileset`, `api`, `metric`, `topic`, `index`, `logicview`, `dataset`. |
| `find --name <name> [--catalog-id <c>] [--exact] [--limit]` | Search by name. `--limit` is the rows scanned before filtering — raise it when an expected match doesn't show up. |
| `get <id>` / `enable\|disable <id>` / `delete <id>` | Detail / change enabled state / delete. |
| `query <id> [--filter <json>] [--sort f:desc,g] [--output-fields a,b] [--limit] [--offset] [--paging-mode single\|cursor] [--keep-alive-sec 60-3600] [--need-total] [--binary-mode metadata\|content] [--ignore-local-index]` | Data rows (default limit 50). `--filter` is a Vega `filter_condition` object; `--sort` entries are `field[:asc\|desc]`. `--ignore-local-index` reads a table's source even when a local index exists; the response's `query_source` says which path answered. `--cursor <c>` continues from `paging.next_cursor` and takes no other query flags. Same flags as `vega resource query`. |

For BKN object-type binding use `data_source: { type: "resource", id }`.
