# Datasources

## Goal

Discover and inspect the data sources feeding knowledge networks and dataflows.

## User-visible behavior

- `openbkn ds list` — datasources (limit 30).
- `openbkn ds get <id>` — connection metadata (never secrets).
- `openbkn ds preview <id>` — sample rows / schema preview (limit 50).
- CSV import helper: bulk-load tabular data where the backend supports it.

## SDK touchpoints

- `resources/datasources.ts` over `api/datasources.ts`; CSV handling via `csv-parse` + encoding detection (`chardet`/`iconv-lite`).

## Edge cases

- Encoding: detect and normalize non-UTF-8 CSV before upload; surface detected encoding.
- Never print credentials or connection strings; redact in `get`.
- Preview is bounded — never stream a full table.
