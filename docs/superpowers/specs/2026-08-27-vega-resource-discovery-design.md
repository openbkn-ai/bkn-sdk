# Vega Resource Discovery SDK Design

## Scope

Adapt the SDK and CLI to Foundry's resource-level discovery contract:

1. Trigger discovery with `POST /resources/{id}/discover`.
2. Surface `resource_id` and read-only `queue_priority` on discovery tasks and
   filter task history by resource.
3. Represent Resource enablement independently from its discovery status and
   expose the enable/disable actions.

The scheduler's internal priority ordering is not configurable and is not a
public sort field.

## Design

- Keep discovery transport in `api/vega-discovery.ts`, alongside catalog
  discovery and task history. `discoverResource` takes only the resource id
  because the endpoint does not accept a strategy.
- Keep resource enablement in `api/resources.ts` and expose it from the
  programmatic `resource` namespace. Resource PUT helpers carry the current
  `enabled` value so a user-owned update cannot accidentally change it.
- Parse `enabled` as a required Resource response field. Resource status
  remains forward-compatible and no longer models `disabled` as a status.
- Expose the resource discovery trigger through `client.vega`, matching the
  existing catalog discovery operation. Add matching `vega resource discover`,
  `enable`, and `disable` commands. The top-level `resource` alias also exposes
  enable/disable for parity with the Vega resource commands.
- Add `--resource-id` to discovery-task list. Keep `queue_priority` output-only:
  it is returned in task objects but cannot be supplied as a list sort or a
  command option.

## Compatibility

This is part of the unreleased 0.1.5 surface. Existing callers that inspect
`ResourceStatus` must stop treating `disabled` as a discovery status and use
`enabled` instead. Full resource updates preserve the server's current enabled
state automatically.

## Verification

- Unit-test request paths, task query mapping, and response parsing.
- Unit-test that full Resource PUT preserves `enabled`.
- CLI-test the resource discovery trigger, enable/disable actions, and task
  resource filter.
- Run `npm run lint`, `npm test`, and `git diff --check`.
