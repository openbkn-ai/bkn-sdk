# resource — vega-backend resources

| Command | Notes |
|---------|-------|
| `list [--catalog-id <c>] [--category table] [--limit]` | Browse. `--datasource-id` is an alias of `--catalog-id`; `--type` of `--category`. |
| `find <name> [--catalog-id <c>] [--exact]` | Search by name. |
| `get <id>` / `query <id> [--limit] [--offset] [--paging-mode single\|cursor] [--cursor]` / `delete <id>` | Detail / data rows / delete. Resource queries use Vega's `paging` contract and send the required GET method-override header; `--cursor` continues from `paging.next_cursor`. |

For BKN object-type binding use `data_source: { type: "resource", id }`.
