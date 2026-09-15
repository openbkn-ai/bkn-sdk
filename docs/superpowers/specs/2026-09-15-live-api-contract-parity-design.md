# Live API contract parity

## Problem and evidence

On the 2026-09-15 deployment, `action-type query` returned HTTP 400
`OntologyQuery.NullParameter.OverrideMethod` because the SDK omitted the required
GET override header. Skill list and detail reads rounded nanosecond timestamps:
the server returned `1789268781834562743` while the SDK returned
`1789268781834562800`. Foundry's `search_schema` contract defines
`search_scope` as an object, while the SDK sends an array. Both live schema
probes failed at a downstream dependency, so this last mismatch is established
by the request wire and the API schema, not by a successful live response.
The deployment also accepts `detail_level=summary` on KN detail reads, but the
typed SDK cannot request it.

## Options and decision

1. Leave named calls unchanged and tell callers to use raw API/MCP passthrough.
   This preserves the current surface but leaves named SDK and CLI paths broken.
2. Fix only the two live-reproduced faults. This is smallest but keeps the
   documented schema-scope and KN-detail options unavailable.
3. Align all four named read paths with the documented contracts, preserving
   existing CLI inputs. **Chosen:** it repairs the confirmed faults and gives
   typed callers the missing read controls without changing platform data.

## Behavior

- Action query uses the canonical path and `POST` plus
  `X-HTTP-Method-Override: GET`; its JSON body remains a passthrough.
- Skill JSON reads with nanosecond fields use `parseBigIntJSON`. Safe integers
  remain numbers; unsafe integers become native `bigint`, as on other SDK reads.
- `SearchSchemaOptions.searchScope` accepts a typed object containing concept
  groups and the four include flags. Legacy category arrays are converted to
  that object before the MCP call; unknown category names and an all-disabled
  scope fail locally. The CLI's `--scope object,relation,action,metric` remains
  usable and gains `--concept-groups` for the documented group filter.
- KN detail reads expose `branch` and `detailLevel: "full" | "summary"` in the
  SDK and corresponding CLI flags. Omitted options retain backend defaults.

## Boundaries and verification

Changes stay in `api/` for request building, `commands/` for CLI arguments,
and the matching product specs and CLI reference for user-facing behavior.
Focused mocked-fetch/MCP tests assert the request headers, paths, JSON integer
types, and scope/KN query parameters. `npm run lint` and `npm test` are the
repository gates. Live schema success remains dependent on repairing the
deployment's downstream service; no existing platform objects are modified.
