# Eval management CLI

Expose a focused `openbkn eval` group over the existing `client.evals` management API. The CLI handles flags, JSON files and output; the server owns rule applicability, case generation, Suite versions and Run readiness. Keeping rule preview, persistence and execution separate lets callers review selected resources and blocked cases before writing or running anything.

This does not add a runner, change authentication or bypass TLS. Scheduling, external participants and other operations remain available through the existing SDK.
