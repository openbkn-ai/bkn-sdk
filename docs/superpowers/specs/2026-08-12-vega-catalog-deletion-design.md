# Vega Catalog deletion contract alignment

## Intent

Align the SDK and CLI with the Vega Catalog deletion preflight and the normalized
BuildTask contract introduced by `openbkn-ai/bkn-foundry#802`.

## Scope

- Support `DELETE /catalogs/{id}?dry_run=true` and validate its deletion-impact
  response.
- Keep real deletion as the default and model its empty response as `undefined`.
- Replace the obsolete BuildTask `init` state with `pending`, add `cancelled`,
  and remove the deleted `active` list filter.
- Serialize multiple BuildTask statuses as repeated query parameters.
- Update the Vega CLI and its product and skill references.

DiscoverTask, SemanticUnderstandingTask, and DiscoverSchedule are represented
only inside the deletion-impact response. This change does not introduce full
SDK resources for APIs that the SDK does not currently expose.

## Design

`api/vega.ts` owns the deletion-impact Zod schemas and uses a generic conditional
return type: an explicit `{ dryRun: true }` returns `CatalogDeletionImpact`, while
a real deletion returns `undefined`. The resource layer preserves that type through
its client-bound wrapper.

The CLI keeps comma-separated `--status` input for usability, splits it into an
array, and relies on the shared HTTP client to emit one `status` query parameter
per value. `--dry-run` is an explicit opt-in on `catalog delete`; omitting it
continues to perform the destructive request.

## Compatibility

Removing `init` and `active` is intentionally breaking because the backend no
longer accepts those values. Existing real-delete calls remain source-compatible.
Preflight results are advisory; callers must still handle a conflict from the
subsequent real deletion because the impact can change concurrently.
