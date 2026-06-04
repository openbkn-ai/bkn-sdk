# bkn — knowledge networks

| Area | Commands |
|------|----------|
| KN | `list`, `get <kn> [--stats] [--export]`, `search <kn> <query> [--max-concepts]`, `stats <kn>`, `export <kn>`, `create`/`update`/`delete`, `subgraph <kn> --body`. |
| Schema | `object-type|relation-type|action-type list/get/create/update/delete` (create/update take `--body`/`--body-file`); `action-type query/execute/inputs`. |
| Metric / concept-group / schedules | `metric …`, `concept-group …`, `action-log …`, `action-schedule …`, `job …`. |
| Paths / resources | `relation-type-paths <kn> --body`, `resources`. |
| Local package | `push <dir>` (tar → import), `pull <kn> [dir]` (export → extract), `validate <dir>` (offline structural check). |
| Build a KN | `create-from-catalog <catalog> --name <n> [--tables a,b] [--pk-map t:col] [--build]`; `create-from-csv <catalog> --files <glob> --name <n> [--table-prefix p] [--build]`. |

object-type query strategy (LLM): always pass a small `limit`, paginate with `search_after`, filter with `condition` — wide tables truncate JSON otherwise.

PK detection (create-from-*): `--pk-map t:col` override → schema PK → sample cardinality; a composite schema PK is reported ambiguous (pick one with `--pk-map`) rather than guessed — guards silent data loss.
