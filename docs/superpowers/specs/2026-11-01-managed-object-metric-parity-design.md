# Managed object metric parity

## Problem

`Metric.query` sends Object Metric V1 runtime choices directly to
ontology-query. Its generic lifecycle wrapper merges `bkn_context` into that
request body when a managed interaction already exists. Ontology-query binds
the body strictly to `ObjectMetricQueryRequestV1`, which deliberately contains
only metric runtime choices, so the managed call fails before execution.

The adjacent contracts also differ in two ways:

- Context Loader's `query_metric` and `drill_through_metric` do not carry the
  branch supported by ontology-query and the public SDK. Routing a generated
  non-main package through them would silently query `main`.
- Context Loader adds `kn_id`, `metric_id`, and `version` to its tool result,
  while `Metric.query` returns ontology-query's Object Metric V1 data envelope.
  Transport selection must not change that public return shape.
- Skill-package templates still teach the retired `time.instant`,
  `analysis_dimensions`, and `datas[].values[]` request/response shape, causing
  newly generated Skills and function examples to call V1 incorrectly.
- Business-provenance resolution reloads the authoritative metric definition
  without the operation's branch, so a successful non-main query can later be
  explained using `main` metadata.

Sandbox images compound the problem by pinning the Python OSDK to an older
commit. The runtime distribution version remains `0.1.0`, so the pinned commit,
resolved import path, and module digest are the useful build identity.

## Contract baseline

The immutable published Object Metric V1 contract owned by ontology-query is
the semantic baseline:

- query body: `filter`, `group_by`, `having`, `order_by`, `page_size`, `cursor`,
  `time`, and `bucket_selection`;
- query string: published `version` and optional `branch` (default `main`);
- result: `model`, `entries`, aggregate status, paging, warnings, duration, and
  evaluation/effective-window metadata.

Context Loader owns managed interaction validation, evidence, and receipts. It
must remove `bkn_context` before forwarding the metric runtime query; ontology-
query must not learn the lifecycle envelope or relax unknown-field validation.

## Approach

### Python OSDK

- Keep unmanaged `Metric.query` on the direct ontology-query REST endpoint and
  send only the Object Metric V1 runtime body.
- When the context is traced or already carries a complete interaction, call
  Context Loader's MCP `query_metric` with JSON response format, the immutable
  metric version, optional non-main branch, nested runtime query, and the
  interaction's `bkn_context`.
- Accumulate the MCP receipt on the active interaction and preserve
  `parent_operation_id` through the existing lifecycle object.
- Remove only Context Loader's top-level identity wrapper from the managed
  response so callers receive the same Object Metric V1 envelope on both
  transports. Preserve forward-compatible result fields.

### TypeScript SDK

- Keep the direct Object Metric V1 client unchanged apart from branch
  regression coverage; its request and response types already match the
  ontology contract.
- Treat `drill_through_metric` like `query_metric` in generic Context Loader
  calls, supplying the known `kn_id` and JSON response format instead of
  inheriting the tool's TOON default.

### Context Loader

- Add optional `branch` to metric query and drill-through request contracts,
  default it to `main`, pass it to ontology-query's internal endpoint, and
  retain the normalized value in metric evidence events.
- Keep strict runtime query validation and authorization downstream. This is an
  additive request field and does not change existing callers.
- Declare optional `bkn_context` on the public REST schemas even though the
  lifecycle middleware consumes it before strict handler binding.
- Update MCP schemas, generated SDK contracts, evidence schema identities, and
  sandbox capability stubs together.

### Sandbox distribution

- Extend the image build check to report and verify the installed `metrics.py`
  path and SHA-256 in addition to the pinned source commit.
- After the SDK fix is reviewed and committed, repin sandbox images to that
  immutable commit and rebuild the templates. The pin cannot point at an
  uncommitted working tree.

### Authoring guidance

- Align SDK and foundry Skill templates on published `metric_id`/`version`,
  `query.time={start,end}`, optional `query.group_by` property references, and
  the V1 `entries[].value` result envelope.
- Add a static contract test so retired metric fields cannot re-enter the SDK's
  create-skill assets unnoticed.

### Business provenance

- Read the live network export and immutable metric provenance from the branch
  recorded in the `query_metric` input, defaulting absent legacy inputs to
  `main`.
- Keep signed historical projection reads branch-agnostic: the projection is
  already an exact snapshot and must not acquire a live-source selector.

## Compatibility and boundaries

- Existing unmanaged reads keep their endpoint, body, and return shape.
- Existing managed main-branch reads become successful and retain evidence.
- Non-main managed reads become explicit and correct instead of silently using
  main.
- No ontology-query request field is added and strict unknown-field rejection
  remains in place.
- TypeScript's direct Object Metric V1 client already matches the baseline;
  only generic Context Loader defaults are completed for drill-through.

## Verification

- Python strict-handler tests reject `bkn_context` on ontology-query and prove
  managed reads use MCP, preserve every runtime choice, normalize the result,
  and retain receipts and parent operation identity.
- Context Loader tests cover branch default/forwarding for query and drill-
  through, strict REST binding after lifecycle stripping, MCP schemas, and
  generated tool parity.
- Enterprise provenance tests prove the operation branch reaches both live
  network and metric-definition reads, while projection reads stay unchanged.
- Contract capture/regeneration must produce no unexplained diff.
- Run the focused suites, then the repositories' lint/type/test gates.
