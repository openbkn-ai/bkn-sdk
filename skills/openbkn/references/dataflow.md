# dataflow — document workflows

| Command | Notes |
|---------|-------|
| `list` / `runs <dagId> [--since] [--limit n] [--page n]` / `logs <dagId> <instanceId>` | DAGs / run history / step logs. `runs` backend defaults to 20; pass `--limit` to page further. |
| `run <dagId> --url <remote> --name <file>` | Trigger with a remote file. |
| `create --body <json>` | Create a DAG from a full document (title + steps required). |
| `templates` | List bundled dataset/bkn/dataflow templates. |
| `create-dataset --template <name> --set k=v …` | Instantiate a dataset template → vega resource. |
| `create-bkn --template <name> --set k=v …` | Instantiate a bkn template → knowledge network. |

CSV ingestion is also available via `bkn create-from-csv` (runs a database-write DAG per batch).
