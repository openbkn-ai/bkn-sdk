# Vega (data catalog / observability)

## Goal

Browse the Vega catalog — data sources, views, atomic views, connector types — and run health checks.

## User-visible behavior

- `openbkn vega catalog list` — catalog entries (limit 30); `openbkn vega catalog resources <id>` — resources under an entry.
- `openbkn vega catalog test-connection-config --connector-type <type> --connector-config <json>` — test an unsaved physical Catalog configuration without creating or updating a Catalog.
- `openbkn vega catalog test-connection <id>` — synchronously test the persisted configuration and inspect the returned `success` business result.
- `openbkn vega catalog health <id>` — read the latest typed health status for one Catalog.
- `openbkn vega catalog health-check-schedule <id>` / `set-health-check-schedule <id>` — read or fully update a physical Catalog's independent schedule.
- `openbkn vega catalog delete <id> --dry-run` — preview the resources, pending
  tasks, running blockers, and schedules affected by deletion. Omit `--dry-run`
  to perform the real deletion.
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
- `openbkn vega dataset build-list --status pending,running` — filter by one or
  more statuses; the SDK sends repeated `status` query parameters. Use
  `--sort create_time|start_time|finish_time|last_progress_time` and
  `--direction asc|desc` for ordering.
- `openbkn vega dataset build-start <task-id> [--reset]` — `--reset` restarts only a full task; it is ignored for incremental tasks.

**Field searchability is separate** — declared on the resource property schema via
`feature_type` (`keyword` | `fulltext` | `vector`). The Resource configuration
determines what is indexed; the BuildTask uses its snapshot.

## SDK touchpoints

- `resources/vega.ts` over `api/vega.ts`. BuildTask create/status map to `POST /build-tasks` and `GET /build-tasks/{id}`. The create response contains only `id`; obtain task state and its persisted `execute_type` through the status endpoint.
- `vega.testCatalogConnectionConfig(request)` calls `POST /catalogs/test-connection`; it never persists a Catalog or health state.
- `vega.testCatalogConnection(id)` calls the persisted-Catalog endpoint. Both connection-test methods return `{ success, message? }`; `success: false` is a completed probe, not an HTTP failure.
- `vega.createCatalog(request, { allowUnhealthy })` accepts an optional `healthCheckSchedule`. `vega.updateCatalog(id, request, { allowUnhealthy })` follows the backend's full PUT contract and always injects the path ID into the body.
- `vega.catalogHealthCheckSchedule(id)` and `vega.updateCatalogHealthCheckSchedule(id, request)` use the dedicated GET/PUT endpoint. Modes are `inherit`, `enabled`, and `disabled`; only `enabled` accepts `cronExpr`.
- `vega.deleteCatalog(id, { dryRun: true })` returns a typed
  `CatalogDeletionImpact`; `vega.deleteCatalog(id)` performs the real deletion
  and returns `undefined`.
- Vega dynamic-data responses (`vega.sql()` and resource previews) preserve
  integers outside JavaScript's safe range as native `bigint`. Other JSON
  numbers remain `number`. Use the exported `stringifyBigIntJSON()` helper
  instead of native `JSON.stringify()` when serializing a result containing
  `bigint`.

## Edge cases

- Preview is bounded (limit 50); never stream full datasets.
- Health checks summarize per-resource status; a partial failure is reported per resource, not as a single opaque error.
- Catalog connection probes have a 60-second SDK timeout. Writes and connection tests are never automatically retried.
- Health-check schedules exist only for physical Catalogs. The Catalog list/get responses do not embed them.
- Custom health-check Cron expressions must not run more frequently than hourly; the backend remains the authority for validating the expression.
- Build is **not** freely re-runnable — it kicks a task and returns a `task-id`; never auto-retry, surface the id for `build-status` polling.
- BuildTask statuses are `pending`, `running`, `stopping`, `stopped`,
  `completed`, `failed`, and `cancelled`. Start accepts only `stopped` or
  `failed`; stop accepts only `pending` or `running`.
- `execute_type` is batch-only. Streaming tasks must not send it. A failed batch task resumes by default; use `--reset` only when a full task must rebuild from the beginning.
- A deletion preflight is advisory. A later real deletion can still return a
  conflict if task or resource state changes between the two requests.
- `openbkn --json` emits native BIGINT values as unquoted JSON number literals.
  Downstream JavaScript must use a bigint-aware parser; ordinary `JSON.parse`
  is not precision-safe for these values.
