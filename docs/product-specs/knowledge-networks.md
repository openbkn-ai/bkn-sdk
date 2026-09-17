# Knowledge networks (BKN)

## Goal

Work with Business Knowledge Networks: list/inspect networks, query their schema and instances, and move BKN packages between disk and the platform.

## BKN format

- BKN is defined by the upstream **BKN specification** (root `network.bkn`, subdirs `object_types/`, `relation_types/`, `action_types/`, `concept_groups/`; optional `CHECKSUM` inside the dir). Format parsing/validation is the spec's job — see [../references/bkn-spec-llms.txt](../references/bkn-spec-llms.txt).
- This SDK owns the **platform side**: HTTP push/pull, encoding detection + UTF-8 normalization on `.bkn`, packaging for upload.
- macOS packaging must set `COPYFILE_DISABLE=1` so `._*` metadata files don't break backend tar parsing.

## User-visible behavior

- `openbkn bkn list` — networks (default limit 30).
- `openbkn bkn get <id> [--branch b] [--detail-level full|summary]` — one network; `detail_level` per the contract (`summary` = concept ids and names); on 0.1.5 deploys it only changes the answer together with `--export`, and even then summary still carries full definitions (openbkn-ai/bkn-foundry#1632).
- `openbkn bkn resources [--keyword s]` — BKN-backend resources (knowledge networks); always sends `resource_type=knowledge_network`, which the backend requires (without it the answer is empty).
- `openbkn bkn search <id> <query>` accepts a quoted query beginning with `-`
  without requiring a preceding `--` separator. A query shaped like a long flag
  (`--rerankk`) is refused as an unknown option unless it follows `--`.
- Search budgets `--max-object-types` and `--max-instances` are positive whole
  numbers; omit them to leave the platform defaults unchanged.
- `openbkn bkn query <id> ...` — query object types / instances (default limit 50).
- `openbkn bkn push <dir>` / `openbkn bkn pull <id>` — upload/download a BKN package; optional encoding detection (`--no-detect-encoding`, `--source-encoding`). `push` passes `--import-mode normal|overwrite|ignore`, `--no-strict-mode` and `--binding-policy preserve|detach` to the import. Verified on 0.1.5 (14.103.77.23): `binding_policy` is validated, but `import_mode` and `strict_mode` are accepted and not applied — every mode re-applies same-id edits and refuses a new id reusing an existing name (403 `ObjectTypeNameExisted`).
- Schema creates (`object-type`/`relation-type`/`action-type`/`metric create`) send `X-HTTP-Method-Override: POST` with an `{entries:[…]}` body; ontology-query reads tunnelled over POST (`object-type query`, `action-type query`, `subgraph`) send `X-HTTP-Method-Override: GET`.
- `object-type query` pages by cursor (`paging.next_cursor` → body `cursor`) on deploys that include foundry #1623; older deploys return no `paging` and page with body `offset`; `action-log list` pages by `--search-after`. `concept-group list` and `action-schedule list` return every row unless `--limit` is given (the backend's own default of 10 would truncate silently).
- Comma-joined ids in DELETE paths (`concept-group remove-members`, `action-schedule delete`) are encoded one by one; an empty list is refused before any request.
- An object type's `### Data Properties` table may include an optional `Mask Rule`
  column containing one compact JSON object. The supported discriminated rules
  are `fixed`, `partial`, and `email` for string-like properties; `round` for
  numeric properties; and `date_granularity` for date/time properties. Legacy
  tables without this column remain valid.
- `bkn push` validates mask-rule JSON, required parameters, bounds, property-type
  compatibility, and kind-specific fields before packaging or making a network
  request. `bkn pull` preserves the `.bkn` payload unchanged.
- The CLI `bkn push` reads the target branch's visible object-type list before and
  after import. It warns on stderr, naming an object type and property, when a
  `data_source` binding disappears/changes or `condition_operations` are lost.
  With `--binding-policy detach` a dropped binding is the requested outcome: an
  object type whose `data_source` is gone after push, and the index operators
  that went with it, produce no warning (a binding changed to another resource,
  or an object type that disappeared, still warns).
  The list is filtered by the current user's `view_detail` permission, so this
  check cannot cover object types the user cannot see. An entry without a
  `data_properties` key (the backend omits an empty list) has no properties.
  The raw import response gains `integrity_warnings` only when warnings exist;
  scripts using `--json` can check the same result. A 404 before upload means
  there is no previous branch to compare. A 401/403 before upload warns
  `integrity not verified: <reason>` (stderr in the CLI, `integrity_warnings` in
  the result) and the upload proceeds unverified. Other pre-upload read failures
  (malformed list, 5xx) stop the push; a post-upload read failure is reported explicitly because the import
  may already have succeeded. Programmatic `kn.push` callers can opt into this
  check with `verifyIntegrity: true`.
- `bkn validate` checks the physical Markdown rows in structured table sections
  that the backend imports (including `metrics/`), reporting the relative file
  path and line for missing leading pipes, misaligned columns, or an incomplete
  physical row. Ordinary prose directly after a complete table is accepted,
  as the backend parser accepts it. Description sections, `network.bkn`, and `risk_types/` tables
  remain prose. `bkn push` rejects these errors before packaging.
  The backend treats even `\|` as a column separator, so table cell text must
  use a different character in place of a pipe and stay on one physical line.
  Structured table rows must stay contiguous. `Logic Properties` must use either
  a flat table or `####` property subsections; mixing them drops the flat rows.
- A managed-v2 `bkn_start_interaction` always carries `question`, `agent_name`
  (`openbkn-sdk` unless `ClientOptions.agentName` says otherwise) and
  `conversation_mode`: `new` without a conversation ID, `continue` with one.
  Legacy managed-v1 deploys get `conversation_mode` only when their catalog
  declares it. If that handshake fails, the SDK surfaces the lifecycle error and
  does not send an uncontexted business request.
- The dedicated `context query-object-instance` command and SDK wrapper reject
  unknown top-level argument keys, extra `filters[]` / `sort[]` keys, and
  misspelled nested condition keys before opening an MCP session. Each filter
  requires `field`, `op`, and `value`; `condition` and `filters` cannot be combined
  because the backend ignores `filters` when `condition` is present. `cursor`
  and `offset` are mutually exclusive, and an explicit `kn_id` must match the
  network being queried. Each sort item requires `field` and an
  `asc` or `desc` direction. A composite condition uses `sub_conditions`; vector
  search uses `condition.operation=knn`. `properties` must be an array of nonblank field
  names. When a nonempty `properties` list is supplied, the dedicated wrapper
  reads the object-type schema once through BKN REST and rejects names absent
  from its data properties before sending the MCP query. Logic properties use
  `get-logic-properties` instead. A hidden or
  unreadable schema also stops the query. Calls without `properties` do not add
  this read; `--dry-run` previews the MCP tool arguments before any schema read
  or session handshake and sends no request. The generic `context tool-call` remains
  a raw MCP path.

## Index building (via Catalog BuildTask — no KN-level build)

There is **no KN-level build**. The legacy `bkn build` (a `job_type:"full"` job under `bkn-backend/.../jobs`) is removed and not reimplemented. Index / instance data is produced by **Catalog BuildTasks** at resource granularity — `POST /build-tasks` with config on the task. See [vega.md](vega.md) → *Index build (BuildTask)*.

A KN is the schema/ontology layer; it **references** already-built Catalog resources and does not own a build lifecycle. Rationale: KN→Catalog is one-to-many and the data layer must build independently of the schema layer — driving builds from a KN verb would invert the layering and be ambiguous.

`bkn create-from-catalog` binds each catalog table to the Vega resource discovery already created for it (physical resources are no longer created through REST), then creates the KN and its object types (each OT bound to a resource). It never configures or starts index builds; update the Resource schema/index configuration, then create a BuildTask through `openbkn vega resource build`.

## SDK touchpoints

- `resources/knowledge-networks.ts` over `api/knowledge-networks.ts`, `api/ontology-query.ts`.
- Context loading (retrieval + ranking + compression for agents) lives alongside: `resources/context-loader.ts`.
- Build is **not** here — it lives in `resources/vega.ts` (Catalog resource build).

## Edge cases

- Large networks: paginate; never load full instance sets into memory.
- Dynamic ontology-query values preserve unsafe decimal integers as native
  `bigint` in the SDK and CLI. CLI JSON bodies preserve those literals on the
  request path; use `stringifyBigIntJSON()` instead of native `JSON.stringify()`
  when serializing a result.
- Push of a non-normalized `.bkn` with non-UTF-8 content must warn or normalize per flags.
- Re-push should be idempotent.
