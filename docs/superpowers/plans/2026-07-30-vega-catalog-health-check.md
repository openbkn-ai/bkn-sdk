# Vega Catalog health-check contract alignment plan

1. Add typed Catalog connection-test, schedule, create, and update contracts in
   `api/vega.ts`.
2. Expose preflight and schedule operations through `resources/vega.ts` and the
   public package types.
3. Align Vega Catalog CLI flags and commands with the new API contract.
4. Add request/response regression tests for every new or corrected endpoint.
5. Update the Vega product spec and quality score, then run lint, tests, and
   build.
