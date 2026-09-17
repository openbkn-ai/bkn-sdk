// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** Registered MCP Server discovery (agent-operator-integration). */
import type { RequestContext } from "../types.js";
import { parseBigIntJSON } from "../utils/json-bigint.js";
import { request } from "./http.js";

const PATH = "/api/agent-operator-integration/v1/mcp";

/** Query parameters accepted by the registered MCP Server directory. */
export interface ListMcpServersOptions {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: string;
  name?: string;
  source?: string;
  category?: string;
  status?: string;
  createUser?: string;
  isInternal?: boolean;
  mode?: string;
  all?: boolean;
}

/** List MCP Servers visible to the current caller without reshaping their payload. */
export function listMcpServers(
  ctx: RequestContext,
  opts: ListMcpServersOptions = {},
): Promise<unknown> {
  return request(ctx, `${PATH}/list`, {
    query: {
      page: opts.page,
      page_size: opts.pageSize,
      sort_by: opts.sortBy,
      sort_order: opts.sortOrder,
      name: opts.name,
      source: opts.source,
      category: opts.category,
      status: opts.status,
      create_user: opts.createUser,
      is_internal: opts.isInternal,
      mode: opts.mode,
      all: opts.all,
    },
    responseParser: parseBigIntJSON,
  });
}

/** Read one registered MCP Server including its platform connection addresses. */
export function getMcpServer(ctx: RequestContext, mcpId: string): Promise<unknown> {
  return request(ctx, `${PATH}/${encodeURIComponent(mcpId)}`, { responseParser: parseBigIntJSON });
}

/** Discover the MCP protocol tools available through one registered server. */
export function listMcpServerTools(ctx: RequestContext, mcpId: string): Promise<unknown> {
  return request(ctx, `${PATH}/proxy/${encodeURIComponent(mcpId)}/tools`, {
    responseParser: parseBigIntJSON,
  });
}
