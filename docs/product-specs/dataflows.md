# Dataflows

## Goal

List, trigger, and inspect document/data flow pipelines and their run history.

## User-visible behavior

- `openbkn dataflow list` — flows (limit 30).
- `openbkn dataflow run <id>` — trigger a run; returns a run id.
- `openbkn dataflow runs <id>` — run history (limit 30).
- `openbkn dataflow logs <runId>` — step logs for a run.

## SDK touchpoints

- `resources/dataflows.ts` over `api/dataflow.ts` (and `api/dataflow2.ts` if the backend exposes a v2 surface — consolidate to one client where possible).

## Edge cases

- Triggering a run is **not idempotent** — never auto-retry; surface the run id so the user can poll.
- Long log streams: paginate / tail rather than buffering everything.
- A failed run surfaces the failing step and its error, not just "failed".
