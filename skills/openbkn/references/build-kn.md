# Build a knowledge network (end to end)

From a Vega catalog of tables:
```bash
openbkn bkn create-from-catalog <catalog-id> --name my-kn --build
#   lists tables → introspects columns → resolves one PK per table → creates a
#   vega resource per table → creates the KN → batch-creates object types →
#   (--build) submits one Vega BuildTask per resource. Failure rolls back the KN.
```
From local CSVs: load them into the catalog's own database, then
`openbkn vega catalog discover <catalog-id>` and build from the catalog as
above. There is no CSV import command — the service it ran on is gone.

Then verify + bind: `bkn get <kn> --stats`, `bkn search <kn> "<q>"`, attach to an agent (`agent skill add`). Needs a physical catalog (logical catalogs can't be discovered/written).
