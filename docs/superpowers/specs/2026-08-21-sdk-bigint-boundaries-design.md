# SDK dynamic JSON BIGINT boundaries

## Intent

Preserve unsafe decimal integer literals at SDK boundaries that carry dynamic
business data, without changing the number types of every control-plane API.

## Scope

- Preserve unsafe integers in CLI JSON inputs, Context Loader JSON-RPC input
  and output, the local Explore proxy, raw-call display, and trace-session
  JSON cloning.
- Apply the existing native BIGINT parser to ontology-query operations that
  return dynamic query, action, or metric data.
- Keep the shared HTTP default as `JSON.parse` for typed control-plane APIs.

## Design

Use the existing `parseBigIntJSON` and `stringifyBigIntJSON` helpers at each
dynamic JSON boundary. They use Node's JSON source-text access and `JSON.rawJSON`
to convert only unsafe decimal integer literals to `bigint` and emit them as
unquoted JSON numbers.

`trace-session` retains its JSON-clone semantics by cloning through the same
parser and serializer rather than switching to `structuredClone`.

## Non-goals

- Do not make all SDK responses bigint-aware by default.
- Do not change backend request binding or numeric comparison semantics.
- Do not reinterpret fractional or exponent JSON numbers as bigint.
