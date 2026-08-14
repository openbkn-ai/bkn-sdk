# Vega BIGINT response preservation

## Intent

Preserve the decimal value of Vega dynamic query results that exceed the
JavaScript safe-integer range, without changing the Vega HTTP JSON contract.

## Scope

- Apply a BIGINT-safe response parser only to Vega raw queries and resource-data
  previews.
- Keep safe integers as JavaScript numbers and represent unsafe integers as
  native JavaScript `bigint` values.
- Add regression coverage for both Vega dynamic-data entry points.

## Design

The shared HTTP client already consumes successful responses as raw text. Add
an optional successful-response parser to it, retaining the standard
`JSON.parse` default. Vega's `runSql` and `queryResource` pass a parser built
with `json-bigint` and `useNativeBigInt: true`. The shared HTTP request and
CLI output paths use the matching serializer so a native `bigint` is emitted
as a JSON number literal instead of failing in `JSON.stringify`.

This keeps the parsing concern in `api/`, preserves the existing
`commands -> resources -> api` dependency direction, and avoids changing
response semantics for typed control-plane APIs.

## Rejected alternatives

- Parsing every SDK response with `json-bigint`: broad, undocumented type
  changes for unrelated APIs.
- Converting the value after `JSON.parse`: the original value has already been
  rounded and cannot be recovered.
