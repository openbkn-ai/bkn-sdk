# MCP read commands

## Objective

Expose registered MCP Server discovery through the SDK and CLI without adding any server mutation, market, or tool invocation capability.

## Steps

- [x] Add lossless API and resource wrappers for list, detail, and proxy tool discovery.
- [x] Add `mcp list`, `mcp get`, and `mcp tools` as READ commands with probe and describe support.
- [x] Add MCP documentation, credential-safe CLI output, and focused regression tests.
- [x] Run full unit tests, review the diff, and complete 23-environment read-only validation.
