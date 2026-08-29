# bkn — knowledge networks

| Area | Commands |
|------|----------|
| KN | `list`, `get <kn> [--stats] [--export]`, `search <kn> <query> [--object-types ids] [--max-instances n] [--rerank]`（自然语言召回实例，附带命中对象类的定义）, `stats <kn>`, `export <kn>`, `create`/`update`/`delete`, `subgraph <kn> --body`. |
| Schema | `object-type|relation-type|action-type list/get/create/update/delete` (create/update take `--body`/`--body-file`); `action-type query/execute`. |
| Metric / concept-group / schedules | `metric …`, `concept-group …`, `action-log …`, `action-schedule …`. (No KN-level build jobs — index builds are Vega build tasks, see [vega.md](vega.md).) |
| Paths / resources | `relation-type-paths <kn> --body`, `resources`. Both `relation-type-paths` and `subgraph` need `source_object_type_id` + `direction` (`forward` \| `backward` \| `bidirectional`) + `path_length` (1–3) in the body — omit any of them and the backend 400s. |
| Local package | `push <dir>` (tar → import) `[--build] [--embedding-model <name-or-id>]`, `pull <kn> [dir]` (export → extract), `validate <dir>` (offline structural check). |
| Build a KN | `create-from-catalog <catalog> --name <n> [--tables a,b] [--pk-map t:col] [--build] [--embedding-fields t:col+col] [--embedding-model <name-or-id>]`. |

object-type query strategy (LLM): always pass a small `limit`, paginate with `search_after`, filter with `condition` — wide tables truncate JSON otherwise.

PK detection (create-from-*): `--pk-map t:col` override → schema PK → sample cardinality; a composite schema PK is reported ambiguous (pick one with `--pk-map`) rather than guessed — guards silent data loss.

Table keys in `--tables` / `--pk-map` / `--embedding-fields` take the catalog's table name or a schema-qualified one (`yanfeng_kb.document` matches `document`); an unmatched key errors with the catalog's actual table list. `--embedding-model` takes the model **name** or a numeric model id; both are resolved, because the resource wants each form in a different place — the name in `index_config.default_embedding_model`, the id in every vector feature's `config.embedding_model`. See [vega.md](vega.md).


Index build is NOT automatic. `push`/`CreateKN` never builds an OpenSearch index; the index lives on the Vega resource. `push --build` reads each object type's `vector` index declaration (`### Property Overrides` / `属性覆盖` `索引配置` cell = `… + vector`, or an `索引`/`Index` column saying `vector`) plus its `### Data Source` resource binding, and submits one batch BuildTask per resource (`build_key_fields` = Incremental Key → Primary Key; `vector(<model>)` or `--embedding-model` pins the model). Object types with no vector field, or an unrendered `{{placeholder}}` resource id, are skipped. For the catalog path, declare fields with `--embedding-fields <table>:<col>[+<col>]`. See [vega.md](vega.md).
