# Vega BIGINT response preservation plan

1. Add `json-bigint` and a narrowly scoped native-BIGINT response parser.
2. Allow the shared HTTP client to use an optional successful-response parser.
3. Use that parser for Vega raw-query and resource-data preview responses.
4. Add regression tests for an unsafe BIGINT and a safe integer.
5. Run formatting, lint, unit tests, and the production build.
