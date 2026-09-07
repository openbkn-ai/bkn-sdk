# DataProperty mask-rule SDK design

Date: 2026-09-06

## Intent

Expose the optional, strongly typed DataProperty `mask_rule` contract and make local `.bkn` validation reject invalid rules before upload. The accepted platform design remains the source of truth: [bkn-foundry#1314](https://github.com/openbkn-ai/bkn-foundry/issues/1314), implemented by [bkn-foundry#1343](https://github.com/openbkn-ai/bkn-foundry/issues/1343).

## Chosen representation

- Export a discriminated TypeScript union keyed by `kind` for `fixed`, `partial`, `email`, `round`, and `date_granularity`.
- Represent the optional `.bkn` table field as compact JSON in a `Mask Rule` column. JSON keeps the wire names and value types identical to REST; the backend export escapes table delimiters inside JSON strings.
- Validate the JSON shape, property-type compatibility, Unicode replacement length/printability, and numeric/date bounds offline.
- Run the same offline validation inside SDK `push` before creating the tar or sending a request.

## Compatibility

The column and REST field are optional. Existing `.bkn` directories and object types without `mask_rule` remain valid and round-trip unchanged. Logic properties are not extended.

## Affected layers

- `types.ts`: public mask-rule and DataProperty types.
- `utils/bkn-validate.ts`: `.bkn` table parsing and rule validation.
- `resources/knowledge-networks.ts`: preflight validation before push.
- Unit tests and knowledge-network product documentation.
