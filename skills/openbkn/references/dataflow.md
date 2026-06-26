# dataflow — document workflows (DAGs)

A **dataflow** is a DAG of operator steps (parse → chunk → vectorize → write to
datasets) that processes documents. The CLI surface splits into three jobs:

1. **Inspect / operate** existing DAGs — `list`, `runs`, `logs`, `run`.
2. **Author** a DAG from a raw document — `create --body/--body-file`.
3. **Scaffold** the pieces a document pipeline needs from bundled templates —
   `templates`, `create-dataset`, `create-bkn`.

All commands print parsed JSON. Add the global `--json` / `--compact` flags for
machine-readable output; auth/endpoint come from `--base-url` / `--token` /
`--user` (or `BKN_BASE_URL` / `BKN_TOKEN` / `BKN_USER`).

| Command | Notes |
|---------|-------|
| `list` | All data-flow DAGs (`type=data-flow`, unpaged). |
| `runs <dagId> [--since <date>]` | Run/result records for one DAG. |
| `logs <dagId> <instanceId> [--page] [--limit]` | Step logs for one run instance. |
| `run <dagId> --url <url> --name <file>` | Trigger a run from a **remote file URL**. |
| `create --body <json>` / `--body-file <path>` | Author a DAG from a full document (`title` + `steps` required). |
| `templates` | List bundled dataset/bkn/dataflow templates (local, no network). |
| `create-dataset --template <name> --set k=v …` | Render a dataset template → create a **vega resource**. |
| `create-bkn --template <name> --set k=v …` | Render a bkn template → create a **knowledge network**. |

> **Naming gotcha:** `create-dataset` / `create-bkn` are **not** automation
> endpoints — they are client-side template renderers that call the *resource*
> and *knowledge-network* APIs. They do **not** create or run a dataflow DAG.
> The only DAG-authoring command is `create`. The only DAG-trigger command is
> `run`.

CSV ingestion has its own entry point: `bkn create-from-csv <catalog-id>` (imports
CSVs into a Vega catalog and builds a KN). See [bkn.md](bkn.md).

---

## Endpoints (what each command actually hits)

The backend is **automation v2** for reads/trigger and **v1** for authoring.

| Command | Method + path | Notes |
| --- | --- | --- |
| `list` | `GET /api/automation/v2/dags?type=data-flow&page=0&limit=-1` | `limit=-1` = all rows, server-side filtered to data-flow DAGs. |
| `runs` | `GET /api/automation/v2/dag/<dagId>/results?since=<date>` | `since` omitted when not passed. |
| `logs` | `GET /api/automation/v2/dag/<dagId>/result/<instanceId>?page&limit` | `instanceId` = a single run id from `runs`. |
| `run` | `POST /api/automation/v2/dataflow-doc/trigger/<dagId>` | Body `{ "source_from": "remote", "url": <url>, "name": <name> }`. |
| `create` | `POST /api/automation/v1/data-flow/flow` | Body = the dataflow document. Returns the new DAG id. |
| `create-dataset` | `POST` resource-create API (vega) | Renders `dataset/<name>` template, then creates a resource. |
| `create-bkn` | `POST` knowledge-network create API | Renders `bkn/<name>` template, then creates a KN. |
| `templates` | — (none) | Reads templates bundled into the CLI; offline. |

---

## `dataflow run` — trigger from a remote file

```bash
openbkn dataflow run <dagId> \
  --url "https://files.example.com/contracts/q3.pdf" \
  --name "q3.pdf"
```

| Flag | Required | Default | Notes |
| --- | :---: | --- | --- |
| `<dagId>` | ✅ | — | Positional. The DAG to run; get it from `dataflow list`. |
| `--url` | ✅ | — | Remote file URL. The backend fetches it (`source_from: remote`). |
| `--name` | ✅ | — | File name the run records / passes to the parse step. Include the extension. |

- Only the **remote URL** trigger is exposed by the CLI. There is no
  local-file-upload or empty trigger variant on `run`.
- The DAG must already have a `@trigger/dataflow-doc` step (the `unstructured`
  template provides one) for the document to flow in.
- Returns the trigger response; poll progress with `runs` then `logs`.

---

## `dataflow runs` / `logs` — inspect history

```bash
openbkn dataflow runs <dagId>                          # all run records
openbkn dataflow runs <dagId> --since 2026-06-01       # only since a date
openbkn dataflow logs <dagId> <instanceId>             # default page 0, 30/page
openbkn dataflow logs <dagId> <instanceId> --page 1 --limit 100
```

| Flag / arg | Required | Default | Notes |
| --- | :---: | --- | --- |
| `runs <dagId>` | ✅ | — | DAG id from `list`. |
| `runs --since` | optional | — | Date filter; passed through verbatim (server interprets format). Omit → all runs. |
| `logs <dagId>` | ✅ | — | DAG id. |
| `logs <instanceId>` | ✅ | — | A run/result id from `runs` output (one execution). |
| `logs --page` | optional | `0` | Zero-based page index. |
| `logs --limit` | optional | `30` | Page size (`DEFAULT_LIST_LIMIT`). |

Typical loop: `list` → pick `dagId` → `runs <dagId>` → pick `instanceId` →
`logs <dagId> <instanceId>`.

---

## `dataflow create` — author a DAG from a document

`POST /api/automation/v1/data-flow/flow`. Pass the whole document as JSON via
`--body` (inline string) **or** `--body-file` (path). Exactly one is required;
invalid JSON → `Request body is not valid JSON.`

### Body shape

```jsonc
{
  "title": "my pipeline",            // required
  "steps": [                          // required: array of operator steps
    { "id": "0", "title": "", "operator": "@trigger/dataflow-doc" },
    {
      "id": "1",
      "operator": "@content/file_parse",
      "parameters": { "docid": "{{__0.id}}", "model": "embedding", "source_type": "docid", "version": "{{__0.rev}}" }
    },
    {
      "id": "1001",
      "operator": "@dataset/write-docs",
      "parameters": { "dataset_id": "<content-dataset-id>", "documents": "{{__1.chunks}}" }
    }
  ],
  "trigger_config": { "operator": "@trigger/manual", "dataSource": { "parameters": { "accessorid": "00000000-0000-0000-0000-000000000000" } } }
}
```

Key conventions (mirror the `dataflow/unstructured` bundled template):

- **`steps[].id`** — string ids; downstream steps reference an upstream step's
  output as `{{__<id>.<field>}}` (e.g. `{{__0.id}}`, `{{__1.chunks}}`).
- **`operator`** — `@trigger/dataflow-doc`, `@content/file_parse`,
  `@dataset/write-docs`, etc. (platform operator registry).
- A document DAG starts with a `@trigger/dataflow-doc` step so `run --url` can
  feed a file in.

| Flag | Required | Default | Notes |
| --- | :---: | --- | --- |
| `--body <json>` | one of these | — | Inline JSON document. |
| `--body-file <path>` | one of these | — | Read the JSON document from a file. Wins when both are given (`--body-file` is read first). |

```bash
# inline
openbkn dataflow create --body '{"title":"demo","steps":[{"id":"0","operator":"@trigger/dataflow-doc"}]}'
# from file
openbkn dataflow create --body-file ./pipeline.json
```

The easiest way to produce a valid body is to render the bundled template:
`openbkn dataflow templates` shows the `dataflow/unstructured` template; its
rendered output **is** a valid `create` body (note: the CLI does not auto-create
the DAG from the dataflow template — render it, then feed it to `create`).

---

## Templates: `templates`, `create-dataset`, `create-bkn`

`templates` lists the templates compiled into the CLI (no network). There are
three **types** — `dataset`, `bkn`, `dataflow` — each with named templates and
typed arguments. `--set k=v` (repeatable) supplies arguments; missing required
args raise `Missing required argument(s): <names>`.

```bash
openbkn dataflow templates                       # list all + their arguments
openbkn dataflow create-dataset --template document --set name="contracts"
openbkn dataflow create-bkn --template document \
  --set name="Contracts KN" \
  --set embedding_model_id=<model-id> \
  --set content_dataset_id=<id> --set document_dataset_id=<id> --set element_dataset_id=<id>
```

### Bundled templates and their `--set` arguments

| Type | Template | Required `--set` | Optional `--set` (default) |
| --- | --- | --- | --- |
| `dataset` | `document` | `name` | `catalog_id` (`adp_bkn_catalog`), `source_identifier` (auto-generated) |
| `dataset` | `document-content` | `name` | `catalog_id` (`adp_bkn_catalog`), `source_identifier` (auto) |
| `dataset` | `document-element` | `name` | `catalog_id` (`adp_bkn_catalog`), `source_identifier` (auto) |
| `bkn` | `document` | `name`, `embedding_model_id`, `content_dataset_id`, `document_dataset_id`, `element_dataset_id` | — |
| `dataflow` | `unstructured` | `title`, `content_dataset_id`, `document_dataset_id`, `element_dataset_id` | — |

Notes:

- **`--set` is value-only, always string.** `--set name="a b"` parses on the
  first `=`; everything after is the literal value. Keys with no `=` are
  ignored.
- **`create-dataset` only handles `type=dataset`** templates; **`create-bkn`
  only `type=bkn`**. There is **no `create-dataflow`** subcommand — the
  `dataflow/unstructured` template can only be *listed*, not directly created;
  render it and pass to `dataflow create`.
- For `dataset` templates, an empty/absent `source_identifier` is auto-filled
  with `dataflow_<template>_<base36-time>_<random>`.
- `catalog_id` defaults to `adp_bkn_catalog` — the platform's built-in BKN
  catalog. Override only if your datasets live elsewhere.

### End-to-end document pipeline (the intended order)

```bash
# 1. create the three datasets a document KN needs
openbkn dataflow create-dataset --template document-content --set name="doc-content"
openbkn dataflow create-dataset --template document         --set name="doc-meta"
openbkn dataflow create-dataset --template document-element --set name="doc-elements"
# → note each returned resource/dataset id

# 2. wire them into a knowledge network
openbkn dataflow create-bkn --template document \
  --set name="Docs KN" --set embedding_model_id=<model-id> \
  --set content_dataset_id=<content-id> \
  --set document_dataset_id=<meta-id> \
  --set element_dataset_id=<element-id>

# 3. author the processing DAG (render unstructured template body → create)
openbkn dataflow create --body-file ./unstructured.json   # title + 3 dataset ids baked in

# 4. trigger it on a file, then watch
openbkn dataflow run <dagId> --url <file-url> --name <file.pdf>
openbkn dataflow runs <dagId>
openbkn dataflow logs <dagId> <instanceId>
```

---

## Gotchas

| Symptom | Cause → fix |
| --- | --- |
| `Provide --body '<json>' or --body-file <path>.` | `create` called with neither. Supply one. |
| `Request body is not valid JSON.` | `--body` string isn't valid JSON (often shell quoting). Use `--body-file` for anything non-trivial. |
| `Missing required argument(s): X` | A required `--set` was omitted for `create-dataset`/`create-bkn`. See the arg table. |
| `Template not found: <type>/<name>` | Wrong template name or wrong subcommand for the type. `create-dataset` needs a `dataset` template; `create-bkn` needs a `bkn` template. Run `templates` to see exact names. |
| Looking for `create-dataflow` / a way to "create from the dataflow template" | Doesn't exist. Render `dataflow/unstructured` and feed it to `dataflow create`. |
| `run` does nothing useful | DAG has no `@trigger/dataflow-doc` step, or the `--url` isn't reachable by the backend. The file is fetched server-side; it must be a public/remote URL, not a local path. |
| Empty `runs`/`logs` | Wrong `dagId`, or no runs yet — trigger one with `run` first. `instanceId` for `logs` must come from a `runs` record. |
| `--since` ignored | Pass a date the server accepts; the CLI forwards the value verbatim and drops it entirely when empty. |
