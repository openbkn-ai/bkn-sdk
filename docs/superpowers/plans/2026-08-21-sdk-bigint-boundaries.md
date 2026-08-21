# SDK dynamic JSON BIGINT boundaries plan

1. Enumerate dynamic JSON input, response, output, and clone boundaries.
2. Reuse the native BIGINT helpers at confirmed boundaries while retaining the
   shared HTTP parser default.
3. Add mocked regression tests for unsafe request literals, response literals,
   and output/clone behavior.
4. Run formatting, lint, unit tests, build, and diff checks.
