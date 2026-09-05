# Function Trace parent propagation

Companion to openbkn-ai/bkn-foundry#1319. Base: GitHub main, 669cb0fc8c87c3a461e4553772ee50fd66508f05.

- [x] Add optional parent_operation_id to resolved Context and caller-owned Interaction.
- [x] Inherit BKN_PARENT_OPERATION_ID only when the resolved turn matches the environment turn.
- [x] Send the parent through both typed MCP reads and the kn HTTP facade without adding business parameters.
- [x] Test multiple reads, subsequent invocations, absent parent, and explicit turn override.
- [x] Run 412 unit tests (32 live tests skipped), Ruff, mypy and package build/install verification.
- [ ] Publish reviewed commit, then update Foundry sandbox image dependency pin and perform deployed integration validation.

No Function business code or calculation changes. Parent context is optional; ordinary calls keep the existing two-ID envelope. The full cross-module design and validation are recorded in Foundry docs/plans/2026-09-05-1319-function-trace-parent.md.
