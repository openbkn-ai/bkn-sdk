# bkn — knowledge networks

| Area | Commands |
|------|----------|
| KN | `list`, `get <kn> [--stats] [--export]`, `search <kn> <query> [--object-types ids] [--max-instances n] [--rerank]`（自然语言召回实例，附带命中对象类的定义）, `stats <kn>`, `export <kn>`, `create`/`update`/`delete`, `subgraph <kn> --body`. |
| Schema | `object-type|relation-type|action-type list/get/create/update/delete` (create/update take `--body`/`--body-file`); `action-type query/execute`. |
| Metric / concept-group / schedules | `metric …`, `concept-group …`, `action-log …`, `action-schedule …`. (No KN-level build jobs — index builds are Vega build tasks, see [vega.md](vega.md).) |
| Cypher | `cypher <kn> --query '<cypher>' [--params '<json object>'] [--branch b]` — read-only Cypher over the network's model, straight to bkn-backend and outside any Trace session. Same subset, limits and refusals as `context run-cypher`; answers `{columns, entries}`. |
| Paths / resources | `relation-type-paths <kn> --body`, `resources`. Both `relation-type-paths` and `subgraph` need `source_object_type_id` + `direction` (`forward` \| `backward` \| `bidirectional`) + `path_length` (1–3) in the body — omit any of them and the backend 400s. |
| Local package | `push <dir>` (tar → import), `pull <kn> [dir]` (export → extract), `validate <dir>` (offline structural check). |
| Build a KN | `create-from-catalog <catalog> --name <n> [--tables a,b] [--pk-map t:col]`. |

object-type query strategy (LLM): always pass a small `limit`, paginate with `search_after`, filter with `condition` — wide tables truncate JSON otherwise.

PK detection (create-from-*): `--pk-map t:col` override → schema PK → sample cardinality; a composite schema PK is reported ambiguous (pick one with `--pk-map`) rather than guessed — guards silent data loss.

Table keys in `--tables` / `--pk-map` take the catalog's table name or a schema-qualified one (`yanfeng_kb.document` matches `document`); an unmatched key errors with the catalog's actual table list. Configure and build indexes through Vega. See [vega.md](vega.md).
