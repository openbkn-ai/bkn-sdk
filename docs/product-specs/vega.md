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
`CreateBuildTaskRequest`. Index configuration belongs to the Resource: the CLI
first updates it through `resource.configureIndex`, then creates a task that
snapshots that configuration.

`CreateBuildTaskRequest`:

| Field | Required | CLI flag | Meaning |
| ----- | -------- | -------- | ------- |
| `resource_id` | ✅ | `<resource-id>` (positional) | Which resource to build |
| `mode` | ✅ | `--mode batch\|streaming` | Build mode |
| `execute_type` | — | `--execute-type incremental\|full` | Batch execution type; defaults to `full` |

CLI:

- `openbkn vega dataset build <resource-id> --mode batch [--embedding-fields …] [--build-key-fields …] [--embedding-model …] [--fulltext-fields …] [--execute-type incremental|full] [--wait] [--timeout <s>]` — optional index flags update the Resource, then create a BuildTask.
- `openbkn vega dataset build-status <task-id>` — progress: `status` + `synced_count` / `vectorized_count`.
- `openbkn vega dataset build-start <task-id> [--reset]` — `--reset` restarts only a full task; it is ignored for incremental tasks.

**Field searchability is separate** — declared on the resource property schema via
`feature_type` (`keyword` | `fulltext` | `vector`). The Resource configuration
determines what is indexed; the BuildTask uses its snapshot.

## SDK touchpoints

- `resources/vega.ts` over `api/vega.ts`. BuildTask create/status map to `POST /build-tasks` and `GET /build-tasks/{id}`. The create response contains only `id`; obtain task state and its persisted `execute_type` through the status endpoint.

## Edge cases

- Preview is bounded (limit 50); never stream full datasets.
- Health checks summarize per-resource status; a partial failure is reported per resource, not as a single opaque error.
- Build is **not** freely re-runnable — it kicks a task and returns a `task-id`; never auto-retry, surface the id for `build-status` polling.
- `execute_type` is batch-only. Streaming tasks must not send it. A failed batch task resumes by default; use `--reset` only when a full task must rebuild from the beginning.
