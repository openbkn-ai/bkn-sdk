# MCP Read Commands Design

## Goal

Expose the documented, non-mutating MCP Server discovery surface through the SDK and CLI. The command group is for registered MCP Servers managed by the execution factory; it is separate from Context Loader's agent-facing MCP retrieval commands.

## Scope

Add only these endpoints from `execution-factory/mcp.yaml`:

- `GET /api/agent-operator-integration/v1/mcp/list`
- `GET /api/agent-operator-integration/v1/mcp/{mcp_id}`
- `GET /api/agent-operator-integration/v1/mcp/proxy/{mcp_id}/tools`

Do not add MCP Market, registration, update, delete, publish status, parser, debug, proxy invocation, or public Streamable HTTP/SSE transport endpoints.

## SDK surface

Add `api/mcp.ts` with thin request wrappers and expose them as `client.mcp`:

- `list(options)` accepts the documented pagination and read filters: `page`, `pageSize`, `sortBy`, `sortOrder`, `name`, `source`, `category`, `status`, `createUser`, `isInternal`, `mode`, and `all`.
- `get(mcpId)` returns the server configuration and platform-generated connection information without reshaping it.
- `tools(mcpId)` returns the MCP protocol Tool list from the proxy endpoint without opening a caller-managed MCP transport.

Responses stay lossless. In particular, `create_time` and `update_time` are nanosecond epoch values, so transport parsing must preserve their integer values.

## CLI

Add a top-level `openbkn mcp` group:

```text
openbkn mcp list [--name ... --status ... --mode ... --limit n --page n --all]
openbkn mcp get <mcp-id>
openbkn mcp tools <mcp-id>
```

All three commands are READ. Help explains that `tools` only discovers the tool schema; it does not invoke the upstream server. `describe` maps `mcp-id` to `mcp list`, and `--probe` assigns this group to `agent-operator-integration`.

## Verification

- Unit tests assert encoded paths, pagination/filter query mapping, lossless timestamp parsing, CLI routing, help classification, and describe ID sources.
- Run lint, build, focused tests, and the full unit suite.
- On 14.103.77.23, use only `mcp list`, `mcp get`, and `mcp tools` against existing MCP Server IDs. Do not create, change, publish, or invoke a server.
