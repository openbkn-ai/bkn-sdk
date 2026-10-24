# Object metric contract alignment

## Problem

The Object Metric V1 runtime now exposes a recursive attribute-filter AST,
result pagination, bucket drill-down, and participant drill-through. The SDK
still types query bodies as `unknown`, omits the newer routes, and the generated
Python OSDK sends the capability name `analysis_dimensions` on the wire even
though the query contract requires `group_by`.

## Approach

- Model the published Object Metric V1 query and result envelopes in the
  TypeScript SDK and use those types on trial, query, and drill-through calls.
- Add thin API/resource methods for Object Metric V1 routes that are present in
  the canonical OpenAPI but absent from the SDK.
- Keep the Python `analysis_dimensions` keyword as a compatibility alias, add
  the canonical `group_by` keyword, and always send `group_by` to the service.
- Expose the remaining runtime query choices in Python without duplicating
  server-side semantic validation.
- Update examples and tests so capability discovery continues to use
  `query_capabilities.analysis_dimensions`, while execution uses `group_by`.

No endpoint is removed, no definition schema is duplicated in the SDK, and no
dependency or Node engine changes are included.

## Verification

Unit tests assert exact paths, query parameters, request bodies, result parsing,
the recursive filter shape at compile time, and Python compatibility behavior.
Run TypeScript lint/tests/build and Python ruff/mypy/pytest.
