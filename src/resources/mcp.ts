// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** Registered MCP Server discovery resource surface. */
import {
  type ListMcpServerToolsOptions,
  type ListMcpServersOptions,
  getMcpServer,
  listMcpServerTools,
  listMcpServers,
} from "../api/mcp.js";
import type { RequestContext } from "../types.js";

export function mcp(ctx: RequestContext) {
  return {
    list: (opts?: ListMcpServersOptions) => listMcpServers(ctx, opts),
    get: (mcpId: string) => getMcpServer(ctx, mcpId),
    tools: (mcpId: string, opts?: ListMcpServerToolsOptions) =>
      listMcpServerTools(ctx, mcpId, opts),
  };
}
