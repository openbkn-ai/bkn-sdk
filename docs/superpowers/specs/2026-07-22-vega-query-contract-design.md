# Vega query contract migration

## Intent

Align the SDK and CLI with the Vega raw-query and resource-data OpenAPI contracts
introduced by bkn-foundry commit `ef1e90f8`.

## Scope

- Replace the obsolete raw-query fields with `query_format`, `input_dialect`,
  `paging`, `query_timeout_sec`, and `need_total`.
- Model initial and cursor-continuation requests separately so a continuation
  cannot accidentally repeat the initial query.
- Send resource-data previews with the required method-override header and the
  shared `paging` object.
- Keep the existing `resource.query({ limit, offset, needTotal })` SDK shape as
  a convenience layer, while adding cursor options.

## Design

`api/vega.ts` owns a discriminated TypeScript request union. `vega.sql()`
continues to expose it without CLI concerns. SQL input defaults to the backend
`postgres` dialect when omitted; DSL callers must explicitly use `opensearch`.
The CLI emits a SQL initial request from flags, accepts complete advanced JSON,
and emits a minimal cursor continuation body when `--cursor` is supplied.

`api/resources.ts` translates its friendly options into the backend request
body, including `paging`, and supplies `X-HTTP-Method-Override: GET` through
the shared HTTP client.

## Rejected alternative

Retaining the old field names and translating them silently would conceal a
server-side breaking contract and cannot express the new cursor restrictions.
