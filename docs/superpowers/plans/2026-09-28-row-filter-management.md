# Row-filter management implementation plan

1. Add typed row-filter models and HTTP functions to the bkn-safe API client.
2. Expose get, apply, delete, and explain methods from the admin resource.
3. Add the `openbkn admin row-filter` command group and machine-readable help.
4. Export the public types and update the identity/access product specification.
5. Add focused API and CLI unit tests.
6. Run typecheck, focused tests, lint, and the unit suite serially.
