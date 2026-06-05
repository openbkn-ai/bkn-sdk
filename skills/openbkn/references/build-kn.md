# Build a knowledge network (end to end)

From a Vega catalog of tables:
```bash
openbkn bkn create-from-catalog <catalog-id> --name my-kn --build
#   lists tables → introspects columns → resolves one PK per table → creates a
#   vega resource per table → creates the KN → batch-creates object types →
#   (--build) submits one Vega BuildTask per resource. Failure rolls back the KN.
```
From local CSVs:
```bash
openbkn bkn create-from-csv <catalog-id> --files './data/*.csv' --name my-kn --build
#   Phase 1: import each CSV via a database-write dataflow DAG (first batch
#   creates the table). Phase 2: same as create-from-catalog, with CSV row
#   samples fed into PK detection.
```
Then verify + bind: `bkn get <kn> --stats`, `bkn search <kn> "<q>"`, attach to an agent (`agent skill add`). Needs a physical catalog (logical catalogs can't be discovered/written).
