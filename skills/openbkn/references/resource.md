# resource — vega-backend resources

| Command | Notes |
|---------|-------|
| `list [--catalog-id <c>] [--category table] [--limit]` | Browse. `--type` is an alias of `--category`. |
| `find --name <name> [--catalog-id <c>] [--exact] [--limit]` | Search by name. `--limit` is the rows scanned before filtering — raise it when an expected match doesn't show up. |
| `get <id>` / `enable\|disable <id>` / `query <id> [--limit] [--offset] [--paging-mode single\|cursor] [--cursor]` / `delete <id>` | Detail / change enabled state / data rows / delete. Resource queries use Vega's `paging` contract and send the required GET method-override header; `--cursor` continues from `paging.next_cursor`. |

For BKN object-type binding use `data_source: { type: "resource", id }`.
