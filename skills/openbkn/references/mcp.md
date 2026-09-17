# mcp — 已注册 MCP Server 的只读发现

这组命令查看 execution factory 中登记的 MCP Server；它与 `context` 的知识网络检索 MCP 不同。

| Command | Notes |
|---------|-------|
| `mcp list [--name] [--source] [--category] [--status] [--create-user] [--internal] [--mode] [--sort-by] [--sort-order] [--limit] [--page] [--all]` | 列出当前身份有权查看的 MCP Server。|
| `mcp get <mcp-id>` | 查看配置与平台生成的 `sse_url` / `stream_url` 连接地址。|
| `mcp tools <mcp-id>` | 通过平台发现上游 MCP 的工具及 `inputSchema`；不会调用工具。|

```bash
openbkn mcp list --status published
openbkn mcp get <mcp-id>
openbkn mcp tools <mcp-id>
```

`create_time` 与 `update_time` 是纳秒 epoch，SDK 会保留为 `bigint`。CLI 会打码记录中意外返回的上游凭据。MCP Market、登记、发布、修改和工具调用使用其他执行工厂接口，未包含在这个只读组内。
