# Product sense

## Who it serves

- **Agent / app developers** — embed BKN knowledge, semantic search, and decision-agent chat into their own software via the SDK.
- **End users at the terminal** — query knowledge networks, talk to agents, inspect traces with the `openbkn` CLI.
- **Platform operators** — manage orgs, users, roles, models, and audit logs from the same CLI.

## What "good" looks like

- A task takes one obvious command or one obvious SDK call — no guessing the layer.
- Output is human-readable by default and clean JSON with `--json`; scripts never scrape pretty tables.
- Errors say what failed and what to do, with a non-zero exit code.
- The CLI and SDK never disagree about behavior — same core underneath.

## Non-goals

- No web UI (backend-only platform).
- No Python SDK (dropped in this rewrite).
- Not a 1:1 reimplementation of the legacy tools — unused surface is intentionally left behind.
