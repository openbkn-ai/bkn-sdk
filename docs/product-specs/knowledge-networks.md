# Knowledge networks (BKN)

## Goal

Work with Business Knowledge Networks: list/inspect networks, query their schema and instances, and move BKN packages between disk and the platform.

## BKN format

- BKN is defined by the upstream **BKN specification** (root `network.bkn`, subdirs `object_types/`, `relation_types/`, `action_types/`, `concept_groups/`; optional `CHECKSUM` inside the dir). Format parsing/validation is the spec's job — see [../references/bkn-spec-llms.txt](../references/bkn-spec-llms.txt).
- This SDK owns the **platform side**: HTTP push/pull, encoding detection + UTF-8 normalization on `.bkn`, packaging for upload.
- macOS packaging must set `COPYFILE_DISABLE=1` so `._*` metadata files don't break backend tar parsing.

## User-visible behavior

- `openbkn bkn list` — networks (default limit 30).
- `openbkn bkn get <id>` — one network, summary + schema pointers.
- `openbkn bkn query <id> ...` — query object types / instances (default limit 50).
- `openbkn bkn push <dir>` / `openbkn bkn pull <id>` — upload/download a BKN package; optional encoding detection (`--no-detect-encoding`, `--source-encoding`).

## Index building (via Catalog BuildTask — no KN-level build)

There is **no KN-level build**. The legacy `bkn build` (a `job_type:"full"` job under `ontology-manager/.../jobs`) is removed and not reimplemented. Index / instance data is produced by **Catalog BuildTasks** at resource granularity — `POST /build-tasks` with config on the task. See [vega.md](vega.md) → *Index build (BuildTask)*.

A KN is the schema/ontology layer; it **references** already-built Catalog resources and does not own a build lifecycle. Rationale: KN→Catalog is one-to-many and the data layer must build independently of the schema layer — driving builds from a KN verb would invert the layering and be ambiguous.

`bkn create-from-catalog` binds each catalog table to the Vega resource discovery already created for it (physical resources are no longer created through REST), then creates the KN and its object types (each OT bound to a resource). With `--build` it then **fans out a BuildTask per created resource** (`vega dataset build` semantics) and polls each — replacing the legacy single KN-level job. Build granularity = the resources this KN uses, not the whole catalog.

## SDK touchpoints

- `resources/knowledge-networks.ts` over `api/knowledge-networks.ts`, `api/ontology-query.ts`.
- Context loading (retrieval + ranking + compression for agents) lives alongside: `resources/context-loader.ts`.
- Build is **not** here — it lives in `resources/vega.ts` (Catalog resource build).

## Edge cases

- Large networks: paginate; never load full instance sets into memory.
- Push of a non-normalized `.bkn` with non-UTF-8 content must warn or normalize per flags.
- Re-push should be idempotent.
