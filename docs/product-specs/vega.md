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
- `openbkn vega resource list` — resources (limit 30); `openbkn vega resource discover <id>` refreshes one resource's metadata, and `enable|disable <id>` changes only its enabled state.
- `openbkn vega discover-schedule …` — create/list/get/update/delete discovery schedules and enable or disable them explicitly. Full updates require the current `catalog_id`, `enabled`, `strategy`, both time-window bounds, and `--expected-update-time` for optimistic locking.
- `openbkn vega discover-task list|get|delete` — inspect and clean up discovery-task history; list accepts `--resource-id`. Tasks expose a read-only `queue_priority` and cannot be sorted by it.
- `openbkn vega semantic-task create|list|get|delete` — manage semantic-understanding task lifecycles for a Catalog or Resource.
- `openbkn vega resource document-*` — create, read, upsert, and delete dataset documents. Batch create/delete-by-filter use Vega's required method-override header internally.
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
| `mode` | ✅ | `--mode batch` | Build mode; streaming is not currently supported |
| `execute_type` | — | `--execute-type incremental\|full` | Batch execution type; defaults to `full` |

CLI:

- `openbkn vega dataset build <resource-id> --mode batch [--embedding-fields …] [--primary-key-fields …] [--incremental-fields …] [--embedding-model <model-id>] [--fulltext-fields …] [--execute-type incremental|full] [--wait] [--timeout <s>]` — optional index flags update the Resource, then create a BuildTask. Batch builds require both key groups: primary fields generate document IDs, while incremental fields drive cursor checkpoints. `--embedding-model` takes a small-model name or ID. It is written twice, in different forms: the name into `index_config.default_embedding_model`, the ID into each vector feature's `config.embedding_model` — the resource rejects either form in the other's place.
- `openbkn vega dataset build-status <task-id>` — progress: `status` + `synced_count`; a document is counted only after all required index processing, including vectorization, succeeds.
- `openbkn vega dataset build-list --status pending,running` — filter by one or
  more statuses; the SDK sends repeated `status` query parameters. Use
  `--sort create_time|start_time|finish_time|last_progress_time` and
  `--direction asc|desc` for ordering.
- `openbkn vega dataset build-start <task-id> [--reset]` — `--reset` restarts only a full task; incremental tasks reject it.

**Field searchability is separate** — declared on the resource property schema via
`feature_type` (`keyword` | `fulltext` | `vector`). The Resource configuration
determines what is indexed; the BuildTask uses its snapshot.

## SDK touchpoints

- `resources/vega.ts` over `api/vega.ts`. BuildTask create/status map to `POST /build-tasks` and `GET /build-tasks/{id}`. The create response contains only `id`; obtain task state and its persisted `execute_type` through the status endpoint.
- `vega.testCatalogConnectionConfig(request)` calls `POST /catalogs/test-connection`; it never persists a Catalog or health state.
- `vega.testCatalogConnection(id)` calls the persisted-Catalog endpoint. Both connection-test methods return `{ success, message? }`; `success: false` is a completed probe, not an HTTP failure.
- `vega.createCatalog(request, { allowUnhealthy })` accepts an optional `healthCheckSchedule`. `vega.updateCatalog(id, request, { allowUnhealthy })` follows the backend's full PUT contract, always injects the path ID into the body, and requires `expectedUpdateTime`, mapped to `expected_update_time` for optimistic locking.
- `vega.catalogHealthCheckSchedule(id)` and `vega.updateCatalogHealthCheckSchedule(id, request)` use the dedicated GET/PUT endpoint. Modes are `inherit`, `enabled`, and `disabled`; only `enabled` accepts `cronExpr`. Schedule updates require `expectedUpdateTime` from the latest response.
- `resource.update` and `resource.configureIndex` read the current Resource before issuing the backend's full PUT and automatically send its `update_time` as `expected_update_time`. An explicit `expectedUpdateTime` on `resource.update` overrides the freshly read value.
- Catalog and Resource list/get/create responses are typed at the HTTP boundary. List responses use summary types and omit detail-only JSON fields; detail GETs preserve the backend batch envelope (`{ entries }`), and their `update_time` values can be passed directly to optimistic updates.
- `vega.discoverSchedules`, `get/create/update/deleteDiscoverSchedule`, and the enable/disable actions cover the full DiscoverSchedule contract. Schedule updates require `catalogId`, `enabled`, `startTime`, `endTime`, `strategy`, and `expectedUpdateTime`, mapped to the backend's strict replacement fields.
- `vega.discoverCatalog`, `discoverResource`, `discoverTasks`, `getDiscoverTask`, and `deleteDiscoverTasks` cover asynchronous manual triggering plus task history. Catalog discovery accepts an optional strategy; resource discovery has no request body. Resource-level tasks include `resource_id` and a read-only `queue_priority`; list filtering accepts `resourceId` but priority is not a sort input. `vega.create/semanticUnderstandingTasks/get/deleteSemanticUnderstandingTask(s)` cover semantic task lifecycles.
- `resource.create` is the typed creation API for user-creatable `dataset` and `logicview` resources. `resource.query`, `createDocuments`, `upsertDocument(s)`, `getDocument`, `deleteDocuments`, and `deleteDocumentsByFilter` cover ResourceData. Dynamic document reads retain unsafe integers as native `bigint`; CLI document JSON and filter input preserve them on the request path too.
- Resource list filtering uses the protocol field `schema` and `catalogId`, mapped to `catalog_id` on the wire. A Resource's `enabled` state is independent of its `active`, `deprecated`, or `stale` discovery status; use `resource.enable` or `resource.disable` to change it. Resource updates preserve the current `enabled` value while catalog/category are read for the strict PUT precondition, and discovery-owned metadata is not sent as mutable input.
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
- DiscoverSchedule PUT is a strict replacement. Callers must send the unchanged `catalogId`, current `enabled`, `strategy`, and both time-window bounds (`0` means unbounded); enable/disable transitions use the action methods.
- Pending or running discovery/semantic tasks cannot be deleted. Batch task deletion is transactional and supports `ignoreMissing`; dataset document deletion by ID is best-effort instead.
- ResourceData write/delete/single-document operations apply only to `category=dataset`. Delete-by-filter requires a non-empty filter.
- Custom health-check Cron expressions must not run more frequently than hourly; the backend remains the authority for validating the expression.
- Build is **not** freely re-runnable — it kicks a task and returns a `task-id`; never auto-retry, surface the id for `build-status` polling.
- BuildTask statuses are `pending`, `running`, `stopping`, `stopped`,
  `completed`, `failed`, and `cancelled`. Start accepts only `stopped` or
  `failed`; stop accepts only `pending` or `running`.
- Streaming BuildTasks are not currently supported. A failed batch task resumes by default; use `--reset` only when a full task must rebuild from the beginning.
- A deletion preflight is advisory. A later real deletion can still return a
  conflict if task or resource state changes between the two requests.
- `openbkn --json` emits native BIGINT values as unquoted JSON number literals.
  Downstream JavaScript must use a bigint-aware parser; ordinary `JSON.parse`
  is not precision-safe for these values.
