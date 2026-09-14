# Vega Resource CLI Alignment Plan

1. Update focused API/resource tests for index config, catalog stats, index capabilities, and typed ConnectorType reads.
2. Remove the public `configureIndex` helper and make Resource update the canonical index-config write.
3. Add Resource create/update/delete CLI commands and move build creation under Resource.
4. Replace `vega dataset build*` with the `vega build-task` lifecycle group.
5. Update grouped help, id-source hints, product documentation, and command tests.
6. Run Biome/TypeScript checks, focused Vitest suites, the full unit suite, and build verification.

