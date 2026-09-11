# Build a knowledge network (end to end)

From a Vega catalog of tables:
```bash
openbkn bkn create-from-catalog <catalog-id> --name my-kn
#   lists tables → introspects columns → resolves one PK per table → creates a
#   binds existing Vega resources → creates the KN → batch-creates object types.
#   Configure and build indexes separately with `openbkn vega dataset build`.
```
From local CSVs: load them into the catalog's own database, then
`openbkn vega catalog discover <catalog-id>` and build from the catalog as
above. There is no CSV import command — the service it ran on is gone.

Then verify: `bkn get <kn> --stats`, `bkn search <kn> "<q>"`. Needs a physical catalog (logical catalogs can't be discovered/written).
