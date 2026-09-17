# Vega (data catalog / observability)

## Goal

Browse the Vega catalog — data sources, views, atomic views, connector types — and run health checks.

## User-visible behavior

- `openbkn vega catalog list` — catalog entries (limit 30); `openbkn vega catalog resources <id>` — resources under an entry.
- `openbkn vega catalog test-connection-config --connector-type <type> --connector-config <json>` — test an unsaved physical Catalog configuration without creating or updating a Catalog.
- `openbkn vega catalog test-connection <id>` — synchronously test the persisted configuration and inspect the returned `success` business result.
- `openbkn vega catalog health <id>` — read the latest typed health status for one Catalog.
- `openbkn vega catalog create --internal` — create a logical Catalog; it takes no `--connector-type`/`--connector-config`. `enabled` is always sent (`false` unless `--enabled`).
- `openbkn vega catalog update <id> [fields]` — reads the Catalog and sends the full PUT with only the given fields changed; `--expected-update-time` defaults to the `update_time` just read.
- `openbkn vega index-capabilities` — local-index analyzers. An undocumented deploy extension outside the vega-backend contract; a deployment without it answers 404 with an explanatory hint.
- `openbkn vega resource query <id>` / `openbkn resource query <id>` — identical flags: `--filter`, `--sort field[:asc|desc],…`, `--output-fields`, `--limit`, `--offset`, `--paging-mode`, `--keep-alive-sec` (60–3600), `--need-total`, `--binary-mode metadata|content`, `--ignore-local-index`; `--cursor` alone for a continuation.
- Enum, boolean and range flags (`catalog list --type/--enabled/--health-check-status/--sort/--direction`, `resource list --category/--status/--sort/--direction`, `build-task list --mode`, `--keep-alive-sec`, `--input-dialect`, discover-schedule `--start-time/--end-time ≥ 0`) are validated before any request.
- `openbkn vega catalog health-check-schedule <id>` / `set-health-check-schedule <id>` — read or fully update a physical Catalog's independent schedule.
- `openbkn vega catalog delete <id> --dry-run` — preview the resources, pending
  tasks, running blockers, and schedules affected by deletion. Omit `--dry-run`
  to perform the real deletion.
- `openbkn vega resource list|get|create|update|delete` — manage Resources; `discover <id>` refreshes one physical resource's metadata, and `enable|disable <id>` changes only its enabled state.
- `openbkn vega discover-schedule …` — create/list/get/update/delete discovery schedules and enable or disable them explicitly. Full updates require the current `catalog_id`, `enabled`, `strategy`, both time-window bounds, and `--expected-update-time` for optimistic locking.
- `openbkn vega discover-task list|get|delete` — inspect and clean up discovery-task history; list accepts `--resource-id`. Tasks expose a read-only `queue_priority` and cannot be sorted by it.
- `openbkn vega semantic-task create|list|get|delete` — manage semantic-understanding task lifecycles for a Catalog or Resource.
- `openbkn vega resource document-*` — create and upsert one dataset document at a time; reads and deletes accept one or more document IDs, with optional `--ignore-missing`. `document-delete-filter <resource-id>` accepts exactly one of `--filter '<json>'` (a native Vega `filter_condition`) or `--selector '<json>'` (an equality selector).
- Health / inspection: connector-type listing and health checks across catalog resources.
- Index build → see **Index build (BuildTask)** below. This is the platform's build task; it replaces the removed KN-level `bkn build` (see [knowledge-networks.md](knowledge-networks.md)).

## Index build (BuildTask)

Building a resource's index is a **BuildTask** — `POST /build-tasks` with a
`CreateBuildTaskRequest`. Index configuration belongs to `PUT /resources/{id}`;
`resource update` saves it, while `resource build` only creates a task that
snapshots the already-saved configuration.

`CreateBuildTaskRequest`:

| Field | Required | CLI flag | Meaning |
| ----- | -------- | -------- | ------- |
| `resource_id` | ✅ | `<resource-id>` (positional) | Which resource to build |
| `mode` | ✅ | fixed to `batch` | Build mode; streaming is not currently supported |
| `execute_type` | — | `--execute-type incremental\|full` | Batch execution type; defaults to `full` |

CLI:

- `openbkn vega resource update <resource-id> --schema-definition '<json>' --index-config '<json>'` — replace Resource schema/features and index configuration through the canonical Resource update API. Keyword defaults use `index_config.default_keyword_ignore_above` (1–8191, default 256).
- `openbkn vega resource build <resource-id> [--execute-type incremental|full] [--wait] [--timeout <s>]` — create a batch BuildTask without changing Resource configuration. BuildTask accepts table Resources only.
- `openbkn vega build-task get <task-id> [--wait] [--timeout <s>]` — progress: `status` + `synced_count`; a document is counted only after all required index processing, including vectorization, succeeds.
- `--wait` on either build or get reports progress on stderr and exits non-zero when the task fails, stops, or the wait times out. `--timeout 0` waits without a polling deadline; status requests retain their HTTP timeout. A timed-out task keeps running on the server.
- `openbkn vega build-task list --status pending,running` — filter by one or
  more statuses; the SDK sends repeated `status` query parameters. Use
  `--sort create_time|start_time|finish_time|last_progress_time` and
  `--direction asc|desc` for ordering.
- `openbkn vega build-task start <task-id> [--reset]` — `--reset` restarts only a full task; incremental tasks reject it. `build-task stop|delete` manage the remaining lifecycle.

**Field searchability is separate** — declared on the resource property schema via
`feature_type` (`keyword` | `fulltext` | `vector`). The Resource configuration
determines what is indexed; the BuildTask uses its snapshot.

## SDK touchpoints

- `resources/vega.ts` over `api/vega.ts`. BuildTask create/status map to `POST /build-tasks` and `GET /build-tasks/{id}`. The create response contains only `id`; obtain task state and its persisted `execute_type` through the status endpoint.
- `vega.testCatalogConnectionConfig(request)` calls `POST /catalogs/test-connection`; it never persists a Catalog or health state.
- `vega.testCatalogConnection(id)` calls the persisted-Catalog endpoint. Both connection-test methods return `{ success, message? }`; `success: false` is a completed probe, not an HTTP failure.
- `vega.createCatalog(request, { allowUnhealthy })` accepts an optional `healthCheckSchedule`, always sends `enabled`, and for `internal: true` omits `connector_type`/`connector_config` (rejecting them client-side). `vega.updateCatalog(id, patch, { allowUnhealthy })` reads the Catalog, overlays the patch, and issues the backend's full PUT with the path ID injected; `expectedUpdateTime` defaults to the read `update_time`. `connector_config` is sent only when the patch carries it.
- `vega.catalogHealthCheckSchedule(id)` and `vega.updateCatalogHealthCheckSchedule(id, request)` use the dedicated GET/PUT endpoint. Modes are `inherit`, `enabled`, and `disabled`; only `enabled` accepts `cronExpr`. Schedule updates require `expectedUpdateTime` from the latest response.
- `resource.update` reads the current Resource before issuing the backend's full PUT and automatically sends its `update_time` as `expected_update_time`. An explicit `expectedUpdateTime` overrides the freshly read value. `indexConfig` and `schemaDefinition` are updated only through this method.
- Catalog and Resource list/get/create responses are typed at the HTTP boundary. List responses use summary types and omit detail-only JSON fields; detail GETs preserve the backend batch envelope (`{ entries }`), and their `update_time` values can be passed directly to optimistic updates.
- `vega.discoverSchedules`, `get/create/update/deleteDiscoverSchedule`, and the enable/disable actions cover the full DiscoverSchedule contract. Schedule updates require `catalogId`, `enabled`, `startTime`, `endTime`, `strategy`, and `expectedUpdateTime`, mapped to the backend's strict replacement fields.
- `vega.discoverCatalog`, `discoverResource`, `discoverTasks`, `getDiscoverTask`, and `deleteDiscoverTasks` cover asynchronous manual triggering plus task history. Catalog discovery accepts an optional strategy; resource discovery has no request body. Resource-level tasks include `resource_id` and a read-only `queue_priority`; list filtering accepts `resourceId` but priority is not a sort input. `vega.create/semanticUnderstandingTasks/get/deleteSemanticUnderstandingTask(s)` cover semantic task lifecycles.
- `resource.query` accepts `binaryMode` and `ignoreLocalIndex` on the initial request only (never with `cursor`); responses may carry `query_source` (`local_index` | `source`). `resource.createDocument` rejects a document carrying `_id`.
- `resource.update` strips the server-written `config.dimension` from vector features before the PUT.
- `vega.getIndexCapabilities` calls `GET /index-capabilities`, which the published contract does not document.
- `resource.create` is the typed creation API for user-creatable `dataset` and `logicview` resources. `resource.query`, `createDocument`, `upsertDocument`, `getDocuments`, `deleteDocuments`, `deleteDocumentsBySelector`, and `deleteDocumentsByFilter` cover ResourceData. `deleteDocumentsBySelector` turns each selector field into an equality condition; `deleteDocumentsByFilter` accepts a native Vega `filter_condition`. Dynamic document reads retain unsafe integers as native `bigint`; CLI document JSON and filter input preserve them on the request path too.
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
- ResourceData write/delete/single-document operations apply only to `category=dataset`. Delete-by-filter requires a non-empty selector or Vega filter condition; the CLI requires exactly one of `--filter` and `--selector`.
- Custom health-check Cron expressions must not run more frequently than hourly; the backend remains the authority for validating the expression.
- Build is **not** freely re-runnable — it kicks a task and returns a `task-id`; never auto-retry (the transport resends only when the connection was never established — [RELIABILITY](../RELIABILITY.md#retries)), surface the id through `build-task get`.
- BuildTask statuses are `pending`, `running`, `stopping`, `stopped`,
  `completed`, `failed`, and `cancelled`. Start accepts only `stopped` or
  `failed`; stop accepts only `pending` or `running`. Waits end on `completed`,
  `failed`, `stopped`, or `cancelled` and read only `status`; responses type
  `status`/`mode`/`execute_type` as strings so an unknown value keeps polling
  instead of failing the parse.
- `bkn create-from-catalog` reads table columns from each Resource's
  `schema_definition` (`name`, `original_type` then `type`), falling back to
  `source_metadata.columns` only when that is empty; primary keys come from
  `index_config.primary_key_fields`, falling back to legacy key flags and then
  row sampling. It pages `/resources` by offset until `total_count`, since that
  endpoint documents no `-1`.
- Streaming BuildTasks are not currently supported. A failed batch task resumes by default; use `--reset` only when a full task must rebuild from the beginning.
- A deletion preflight is advisory. A later real deletion can still return a
  conflict if task or resource state changes between the two requests.
- `openbkn --json` emits native BIGINT values as unquoted JSON number literals.
  Downstream JavaScript must use a bigint-aware parser; ordinary `JSON.parse`
  is not precision-safe for these values.
