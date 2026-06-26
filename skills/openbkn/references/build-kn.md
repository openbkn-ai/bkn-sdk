# Build a knowledge network (end to end)

Five flows put data into a knowledge network (KN), grouped by where the schema
comes from:

| Flow | Schema source | Builds the index? |
| --- | --- | --- |
| `bkn create-from-catalog <catalog-id>` | introspected from a Vega catalog's tables | only with `--build` |
| `bkn create-from-csv <catalog-id>` | local CSVs imported into the catalog, then introspected | only with `--build` |
| `bkn push <directory>` | a hand-authored BKN directory (markdown `.bkn` files) | only with `--build`, from `vector` declarations |
| `bkn pull <kn-id> [dir]` | downloads an existing KN to a BKN directory (round-trips `push`) | n/a |
| `bkn create <name>` | none — an empty KN you fill in via schema CRUD | no |

> **There is NO KN-level `bkn build`.** The OpenSearch / vector index is built
> **per Vega resource** (one resource = one table) by a Vega BuildTask:
> `vega dataset build <resource-id>` (see [vega.md](vega.md)). `--build` on the
> commands below is a convenience that repoints to that per-resource Catalog
> build — it submits one BuildTask per resource, it is not a separate build
> system. `bkn push` / backend `CreateKN` never auto-build.

All flows that touch a catalog need a **physical** catalog. Logical catalogs
cannot be discovered or written to.

---

## bkn create-from-catalog — KN from a catalog's tables

```bash
openbkn bkn create-from-catalog <catalog-id> --name my-kn --build
```

Pipeline (from `src/resources/bkn-create.ts`):

1. List the catalog's `table` resources. If empty, run `discoverCatalog` once
   to scan metadata, then list again. Error if still empty.
2. Introspect each table's columns + declared primary keys.
3. Filter to `--tables` if given.
4. Resolve **one** PK per table (priority: `--pk-map` → schema single PK →
   100-row cardinality sample). **Fail-fast** — a composite/undetectable PK
   aborts before any side effect (avoids the silent wrong-key data-loss bug).
5. Create one Vega resource per table (idempotent: reuses an existing exact-name
   resource in the catalog, else creates it).
6. Create the KN, then **batch-create** all object types in one all-or-nothing
   transaction.
7. `--build`: submit one Vega BuildTask (`mode: batch`) per resource.

Any failure **after** the KN exists rolls the KN back (cascades to its object
types) unless `--no-rollback`.

### Parameters

| Flag / field | Required | Default | Notes |
| --- | :---: | --- | --- |
| `<catalog-id>` | ✅ | — | Vega catalog id (short slug, e.g. `d7nicrcjto2s73d9g67g`), **not** a data-connection UUID. Must be **physical**. |
| `--name <name>` | ✅ | — | KN name. |
| `--tables <list>` | optional | all tables | Comma-separated **table names** (not resource ids). Unmatched names are simply skipped; an empty intersection errors `No matching tables to build from`. |
| `--pk-map <map>` | optional | auto-detect | `'<table>:<col>[,<table>:<col>...]'`. The PK becomes the object type's `primary_keys` and the batch build key. References to unknown tables or non-columns error before any write. |
| `--build` | optional | off | Submit a Vega BuildTask per resource after creation. Without it, **no index is built** — query/vector search won't work until you build (`vega dataset build`). |
| `--embedding-fields <map>` | optional (needs `--build`) | none → only a sync index, no vectors | `'<table>:<col>[+<col>...][,...]'`. `+` joins multiple columns into one resource's `embedding_fields`. Columns not listed for a table get no vector. |
| `--embedding-model <id>` | optional (needs `--build`) | server default | Embedding model id for the vector index. Get ids from `model list` / the platform. |
| `--no-rollback` | optional | rollback on | Keep the partially-created KN if a later step fails (for debugging). |

### Examples

```bash
# All tables, no index yet — schema only
openbkn bkn create-from-catalog d7nicrcjto2s73d9g67g --name crm

# Two tables, explicit PKs, build a vector index over chosen columns
openbkn bkn create-from-catalog d7nicrcjto2s73d9g67g --name crm \
  --tables customers,orders \
  --pk-map 'customers:cust_id,orders:order_id' \
  --build \
  --embedding-fields 'customers:name+notes,orders:description' \
  --embedding-model bge-m3

# Composite PK table → must disambiguate (otherwise it aborts)
openbkn bkn create-from-catalog <cat> --name kn --pk-map 'line_items:line_id'

# Keep the half-built KN to inspect what went wrong
openbkn bkn create-from-catalog <cat> --name kn --no-rollback
```

---

## bkn create-from-csv — import CSVs, then build a KN

```bash
openbkn bkn create-from-csv <catalog-id> --files './data/*.csv' --name my-kn --build
```

**Phase 1** — import each CSV into the catalog as a table via a database-write
dataflow DAG (the first batch creates the table; later batches append). Returns
imported table names + a ≤100-row sample per table.
**Phase 2** — exactly `create-from-catalog`, with the CSV samples fed into PK
detection (so PK detection works even before the catalog re-discovers the new
tables).

Derived table name = the file stem, prefixed with `--table-prefix`, with every
non-`[A-Za-z0-9_]` char replaced by `_` and a leading digit prefixed with `_`
(e.g. `2024 sales.csv` → `_2024_sales`). All CSV columns import as
`VARCHAR(512)`.

### Parameters (create-from-csv)

`create-from-csv` shares `--tables` / `--pk-map` / `--build` /
`--embedding-fields` / `--embedding-model` / `--no-rollback` with
`create-from-catalog` (same semantics), **plus**:

| Flag / field | Required | Default | Notes |
| --- | :---: | --- | --- |
| `<catalog-id>` | ✅ | — | Target catalog. Must be **physical** and writable. |
| `--files <glob>` | ✅ | — | CSV paths: a glob (`'./data/*.csv'`, quote it so the shell doesn't expand it) or a comma-separated list. Files with no headers/rows are skipped and reported in `failed_imports`. |
| `--name <name>` | ✅ | — | KN name. |
| `--table-prefix <s>` | optional | `""` | Prefix prepended to each derived table name. |
| `--batch-size <n>` | optional | `500` | Rows per insert batch. Lower it if large rows hit dataflow limits. |
| `--tables <list>` | optional | all imported | Subset of the **imported** tables to include in the KN. |

If **no** table imports successfully, the whole command errors (it never creates
an empty KN). Output adds `imported_tables` + `failed_imports` on top of the
`create-from-catalog` result.

```bash
openbkn bkn create-from-csv <cat> \
  --files './seed/customers.csv,./seed/orders.csv' \
  --name demo --table-prefix demo_ --batch-size 200 \
  --pk-map 'demo_customers:cust_id' --build
```

---

## bkn push — import a hand-authored BKN directory

```bash
openbkn bkn push <directory> [--branch main] [--build] [--embedding-model <id>]
```

Packs the directory **contents** into a tar (`tar cf - -C <dir> .`; macOS
AppleDouble `._*` forks are suppressed) and uploads it multipart to
`POST /api/bkn-backend/v1/bkns?branch=<branch>`. The backend parses the markdown
and creates the KN.

`--build` is **client-side and independent of the backend**: it re-reads the
directory's object-type files, finds every object type declaring a `vector`
index bound to a resource, and submits one Vega BuildTask per resource. The
upload result gets a `build_tasks` array appended. (Plain push never builds —
see [vega.md](vega.md#index-is-not-auto-built-on-bkn-push).)

### Parameters (push)

| Flag / field | Required | Default | Notes |
| --- | :---: | --- | --- |
| `<directory>` | ✅ | — | A BKN directory (see format below). Validate first with `bkn validate <dir>`. |
| `--branch <name>` | optional | `main` | Target branch. |
| `--build` | optional | off | Submit a Vega BuildTask for each object type whose `### Data Source` binds a resource **and** that declares a `vector` index. Object types with no resource binding, an unrendered `{{...}}` placeholder, or no `vector` declaration are skipped. |
| `--embedding-model <id>` | optional | per-file pin, else server default | Embedding model for the declared vector indexes. A per-property `vector(<model>)` pin in the file **wins** over this flag. |

```bash
openbkn bkn validate ./my-kn          # offline structural check first
openbkn bkn push ./my-kn              # schema only, no index
openbkn bkn push ./my-kn --build --embedding-model bge-m3
```

---

## bkn pull — download a KN as a BKN directory

```bash
openbkn bkn pull <kn-id> [directory] [--branch main]
```

`GET /api/bkn-backend/v1/bkns/<kn-id>?branch=<branch>` → tar bytes, extracted
into `directory` (created if missing). **`directory` defaults to `<kn-id>`** when
omitted. Returns `{ knId, dir, bytes }`. Round-trips with `push` — pull, edit,
push back.

| Flag / field | Required | Default | Notes |
| --- | :---: | --- | --- |
| `<kn-id>` | ✅ | — | KN id to download. |
| `[directory]` | optional | `<kn-id>` | Local extract target. |
| `--branch <name>` | optional | `main` | Source branch. |

---

## bkn validate — offline structural check

```bash
openbkn bkn validate <directory>
```

Dependency-free, **offline** (no network). Parses frontmatter + a few markdown
sections. Exit code `1` if invalid. Checks (`src/utils/bkn-validate.ts`):

- `network.bkn` exists at the root, has frontmatter with
  `type: knowledge_network`, an `id`, and a `name`. (**Errors** if not.)
- Each `object_types/*.bkn`: frontmatter `type: object_type`, has `id` + `name`,
  `name` ≤ **40** utf-8 codepoints, ids unique. (**Errors**.)
- Each `relation_types/*.bkn`: frontmatter `type: relation_type`, has `id`; its
  `### Endpoint` source/target should reference known object-type ids
  (**warnings** only, not errors).

It does **not** validate data-source bindings, index config, mapped fields, or
that referenced resources exist. Result shape:
`{ valid, dir, counts:{objectTypes,relationTypes,conceptGroups}, errors[], warnings[] }`.

---

## BKN directory format

A BKN directory is plain UTF-8 markdown with YAML-ish frontmatter. Layout the
CLI reads:

```text
my-kn/
  network.bkn                 # required: the KN itself
  object_types/
    customer.bkn              # one object type per file
    order.bkn
  relation_types/
    placed.bkn                # optional
  concept_groups/             # optional
```

`push` packs **everything** under the dir; `validate` and `--build` only look at
`network.bkn`, `object_types/`, `relation_types/`, `concept_groups/`.

### Frontmatter (every `.bkn` file)

Leading `--- ... ---` block, flat scalars only. Recognized keys: `type`, `id`,
`name`. `type` must be `knowledge_network` (root), `object_type`,
`relation_type`. The object-type `id` (frontmatter) is what `--build` reports as
`objectType`; if absent it falls back to the file stem.

### Sections an object-type `.bkn` may declare (parsed by `--build`)

The `--build` index extractor (`src/utils/bkn-index.ts`) reads these — it does
**not** depend on the backend's parser, so a build works as long as the resource
id is present. Headings are matched at `##`/`###` level, English **or** Chinese
(case-insensitive):

| Section | Heading aliases | What `--build` takes from it |
| --- | --- | --- |
| Data Source (resource binding) | `Data Source` / `数据来源` | First row whose **type** column = `resource` → its **id** column = the build's `resource_id`. A `{{...}}` (unrendered placeholder) id is skipped. **Without a resource binding the object type is not buildable.** |
| Data Properties | `Data Properties` / `数据属性` | Maps property **name** → resource field via a `Mapped Field` / `映射字段` / `映射` column (defaults to the same name). A `vector` in this table's `Index` / `索引` column also marks a property. |
| Property Overrides | `Property Overrides` / `属性覆盖` | A `Index Config` / `索引配置` (or `Index` / `索引`) column containing `vector` marks that property's mapped field for vectorization. `vector(<model>)` pins an embedding model. |

Build-key resolution (the batch `build_key_fields`): an `Incremental Key: <col>`
line if present, else `Primary Key: <col>` / `Primary Keys: <col>` / `**主键**: <col>`
(first value if comma-separated). Backtick-wrapped names are unquoted.

> **Vector vs index.** `--build` counts a property **only** when the index cell
> literally contains `vector` (case-insensitive). A bare `YES` / `fulltext` is
> index-type-agnostic and **deliberately ignored** — it won't trigger a vector
> build. Use `vector` or `fulltext + vector` to opt in.

### What `create-from-catalog`/`-csv` generate (for reference)

Each table becomes an object type with: `data_source = {type:"resource", id:<resource-id>}`,
`primary_keys = [<resolved pk>]`, a `display_key` (first column matching
`name`/`title`/`label`/`display_name`/`description`, else the PK), and one
`data_property` per column (`type:"string"`, `mapped_field` = original column).

---

## Building the index after the fact

If you skipped `--build` (or it's a `bkn create` / hand-pushed KN with no vector
declarations), build per resource manually:

```bash
openbkn resource find --name <table> --exact            # → resource-id
openbkn vega dataset build <resource-id> --mode batch \
  --build-key-fields <pk-or-time-col> \
  --embedding-fields <col1>,<col2> [--embedding-model <id>] --wait
```

`batch` mode **requires** `--build-key-fields` (else `400 build_key_fields is
required for batch mode`). Track with `vega dataset build-status <res> <task>`
or `bkn job list <kn>`. Full reference: [vega.md](vega.md).

---

## Verify + bind

```bash
openbkn bkn get <kn-id> --stats          # object/relation/instance counts
openbkn bkn search <kn-id> "<query>"     # semantic search (needs a built index)
openbkn agent skill add ...              # attach the KN to an agent (see agent.md)
```

---

## Gotchas

| Symptom | Cause → fix |
| --- | --- |
| KN created but `bkn search` returns nothing / no vectors | You didn't `--build`, or built without `--embedding-fields`. Vectors require explicit columns. Build the resource (`vega dataset build … --embedding-fields …`). |
| `Table '<t>' has a composite primary key (...)` | Schema PK is composite; BKN object types take one key. Disambiguate with `--pk-map <t>:<col>`. |
| `Cannot auto-detect a primary key for table '<t>'` | No unique column in the 100-row sample. Pass `--pk-map <t>:<col>`. Wrong PK silently drops rows, so the tool refuses to guess. |
| `--pk-map '<col>' for table '<t>' is not a column` / `--pk-map references unknown table` | Validated before any write — fix the table name or column. |
| `No tables available in catalog after scan` | Catalog is empty or **logical** (can't discover). Use a physical catalog; confirm with `vega catalog get <id>`. |
| `No tables imported` (create-from-csv) | Every CSV was empty/headerless or its dataflow import failed — see `failed_imports`. Check the CSV has a header row and data. |
| `--build` ran but no `build_tasks` for an object type | Its `### Data Source` has no `resource`-typed row, the id is still a `{{...}}` placeholder, or no property declares `vector`. A bare `YES`/`fulltext` index cell is ignored. |
| `tar executable not found` | `push`/`pull` shell out to system `tar`. Install it (Windows: ships with 10 1803+, or via Git for Windows / scoop). |
| Partial KN left behind after a failure | Default rolls back. You'll see it only if you passed `--no-rollback`; delete with `bkn delete <kn-id>`. |
| `bkn validate` warns on endpoint refs but `valid: true` | Endpoint source/target mismatches are warnings, not errors. Push still works; fix the relation files if the warning is real. |

Catalog ids and resource ids are short slugs (e.g. `d7nicrcjto2s73d9g67g`), not
UUIDs. `--embedding-fields` / `--embedding-model` are no-ops without `--build`.
