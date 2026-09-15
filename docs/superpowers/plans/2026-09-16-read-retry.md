# Read retry plan

1. Add an internal opt-in for POST reads and bounded retry helpers to the HTTP
   request layer.
2. Mark ontology subgraph, object-instance, action-type, and metric-data query
   calls as retryable reads.
3. Add mocked regressions for 5xx recovery, network recovery, exhaustion, and
   the no-retry write boundary.
4. Run lint, the focused HTTP suite, the full unit suite, and build; update the
   reliability scorecard with the new coverage.
