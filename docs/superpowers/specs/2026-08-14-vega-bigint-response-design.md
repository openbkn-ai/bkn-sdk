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
`JSON.parse` default. Vega's `runSql` and `queryResource` pass a parser that
uses Node 24 JSON source-text access to convert only integer tokens outside the
JavaScript safe range to `bigint`. This preserves decimal integers without
changing the behavior of fractional values, exponent values, or JSON object
keys.

The parser and serializer live in `utils/`, preserving the existing
`commands -> resources -> api -> utils` dependency direction. Node 24 native
JSON source-text access identifies the original integer token during parsing,
and `JSON.rawJSON()` emits native `bigint` values as JSON number literals for
shared HTTP requests and CLI output. Typed control-plane response semantics
remain unchanged.

## Rejected alternatives

- Parsing every SDK response with `json-bigint`: broad, undocumented type
  changes for unrelated APIs.
- Parsing dynamic responses with `json-bigint`: its native-BigInt parser
  switches on numeric literal length rather than the safe-integer boundary,
  which can misclassify safe integers and reject long fractional values.
- Converting the value after `JSON.parse`: the original value has already been
  rounded and cannot be recovered.
- Retaining a Node 22 compatibility implementation: Node 22 supports the
  required native JSON APIs, but it has entered maintenance. The SDK support
  baseline is Node 24.19.0 for its active security lifecycle, so maintaining a
  separate Node 22 path adds complexity without serving a supported runtime.
