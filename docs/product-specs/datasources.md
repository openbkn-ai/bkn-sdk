# Datasources

## Goal

Discover and inspect the data sources feeding knowledge networks.

## User-visible behavior

- `openbkn ds list` — datasources (limit 30).
- `openbkn ds get <id>` — connection metadata (never secrets).
- `openbkn ds preview <id>` — sample rows / schema preview (limit 50).
- Local CSV parsing/import is not currently exposed by this SDK.

## SDK touchpoints

- Data discovery uses the Vega resources and connectors APIs; there is no local CSV parser dependency.

## Edge cases

- Never print credentials or connection strings; redact in `get`.
- Preview is bounded — never stream a full table.
