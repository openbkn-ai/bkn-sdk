# Foundry contract alignment

## Scope and accepted approach

Align three existing SDK surfaces with Foundry documentation commit `f985e2d`
(#2115). The requester approved these three small contract updates in chat.

- Treat Vega `GET /index-capabilities` as a published API. Keep legacy null or
  omitted analyzer-list normalization; update the stale documentation and 404 hint.
- Keep Metric validation on `/metrics/validation`, the canonical endpoint. Parse
  the response at the API boundary as `{ valid: boolean, detail?: string }`, retain
  additional response fields, and export the result type. A completed validation
  with `valid: false` remains a result in the SDK; the CLI prints that result and
  sets exit code 1. Malformed responses and HTTP errors remain errors.
- Object-type `data_properties` is optional. Existing local validation, query
  field validation, push-integrity snapshots, and Python schema parsing already
  tolerate omission. Preserve that behavior and verify SDK reads with omitted
  properties without inventing a mandatory empty list.

Changing the Metric endpoint to its newly documented compatibility alias offers
no benefit. Throwing for a completed negative validation would hide a useful
business result from SDK consumers. Neither approach is selected.

## Layers and verification

Changes stay within `api`, public exports, CLI output/exit handling, tests, and
product documentation. No platform writes, dependency-version changes, commits,
or publication are included. Add focused mocked regressions for negative and
malformed validation responses, CLI JSON output and exit code, and optional
object properties. Run lint, unit tests, build, and inspect the CLI description.
