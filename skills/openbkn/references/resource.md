# resource — vega-backend resources

| Command | Notes |
|---------|-------|
| `list [--datasource <catalog>] [--category table] [--limit]` | Browse. |
| `find <name> [--datasource <c>] [--exact]` | Search by name. |
| `get <id>` / `query <id> [--limit] [--offset]` / `delete <id>` | Detail / data rows / delete. |

For BKN object-type binding use `data_source: { type: "resource", id }`.
