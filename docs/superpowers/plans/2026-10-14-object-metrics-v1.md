# Object metrics V1 migration plan

1. Record the V1 lifecycle/query contract and remove legacy SDK metric assumptions from the product specification.
2. Implement V1 HTTP methods for definition CRUD, validation, version lifecycle, trial, and published data query. Require explicit query/publish/validate version.
3. Expose those methods through the public `kn` resource; remove obsolete `metric*` SDK methods.
4. Replace the `bkn metric` CLI group with `bkn object-metric`, update discoverability metadata, and add boundary/command tests.
5. Remove or migrate old metric tests and examples; verify `npm run lint`, `npm test`, `npm run build`, and the CLI description. Update quality scorecard with observed results only.
