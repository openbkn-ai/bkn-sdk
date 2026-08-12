# Vega Catalog deletion contract alignment plan

1. Add typed deletion-impact schemas and align BuildTask statuses and list
   serialization in `api/vega.ts`.
2. Expose the conditional deletion result through `resources/vega.ts` and the
   public package types.
3. Add Catalog dry-run and normalized BuildTask filtering to the Vega CLI.
4. Add API and CLI regression tests for deletion and repeated status parameters.
5. Update Vega product and skill references, then run lint, tests, and build.
