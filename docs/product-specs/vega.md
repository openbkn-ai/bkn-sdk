# Vega (data catalog / observability)

## Goal

Browse the Vega catalog — data sources, views, atomic views, connector types — and run health checks.

## User-visible behavior

- `openbkn vega catalog list` — catalog entries (limit 30); `openbkn vega catalog resources <id>` — resources under an entry.
- `openbkn vega resource list` — resources (limit 30); `openbkn vega resource preview <id>` — sample (limit 50).
- Health / inspection: connector-type listing and health checks across catalog resources.
- Index build → see **Index build (BuildTask)** below. This is the platform's build task; it replaces the removed KN-level `bkn build` (see [knowledge-networks.md](knowledge-networks.md)).

## Index build (BuildTask)

Building a resource's index is a **BuildTask** — `POST /build-tasks` with a
`CreateBuildTaskRequest`. The config lives **on the task** (persisted on the
BuildTask), not pre-set on the catalog/resource. The task creates the index then
writes `index_name` back onto the resource.

`CreateBuildTaskRequest` (= the build params, all first-class CLI flags — no raw `call` needed):

| Field | Required | CLI flag | Meaning |
| ----- | -------- | -------- | ------- |
| `resource_id` | ✅ | `<resource-id>` (positional) | Which resource to build |
| `mode` | ✅ | `--mode batch\|streaming` | Build mode |
| `embedding_fields` | — | `--embedding-fields a,b` | Fields to vectorize |
| `build_key_fields` | — | `--build-key-fields k` | Key fields (batch: time field; streaming: unique row id) |
| `embedding_model` | — | `--embedding-model <id>` | Embedding model (default if omitted) |
| `model_dimensions` | — | `--model-dimensions <n>` | Vector dimensions |

CLI:

- `openbkn vega dataset build <resource-id> --mode batch [--embedding-fields …] [--build-key-fields …] [--embedding-model …] [--model-dimensions …] [--wait] [--timeout <s>]` — create a BuildTask.
- `openbkn vega dataset build-status <resource-id> <task-id>` — progress: `state` + `SyncedCount` / `VectorizedCount`.

**Reasonable-state fix:** legacy only forwarded `--mode` and forced raw `kweaver call /build-tasks` for everything else. Here the whole `CreateBuildTaskRequest` is exposed as flags.

**Field searchability is separate** — declared on the resource property schema via
`feature_type` (`keyword` | `fulltext` | `vector`). The BuildTask only decides
*what to embed / how*; whether a field is searchable at all is a schema concern.

## SDK touchpoints

- `resources/vega.ts` over `api/vega.ts`. BuildTask create/status map to `POST /build-tasks` and `GET /build-tasks/{id}` (resource gets `index_name` filled back).

## Edge cases

- Preview is bounded (limit 50); never stream full datasets.
- Health checks summarize per-resource status; a partial failure is reported per resource, not as a single opaque error.
- Build is **not** freely re-runnable — it kicks a task and returns a `task-id`; never auto-retry, surface the id for `build-status` polling.
- `--mode batch` expects a time `build-key-field`; `streaming` expects a unique row id — validate at the boundary.
