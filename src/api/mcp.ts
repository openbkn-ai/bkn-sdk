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

/**
 * One entry of `GET /mcp/list` (`MCPServerConfig`). Only the documented fields
 * are typed; the rest (connection config, tool configs) pass through.
 */
export interface MCPServerConfig {
  /**
   * The caller's effective operations on this server, projected only on the
   * management list. The service omits it when empty, so treat absent as `[]`.
   */
  operations?: Array<"view" | "modify" | "publish" | "unpublish" | "delete" | "authorize">;
  mcp_id?: string;
  /** Configuration version, incremented on each update. */
  version?: number;
  name?: string;
  description?: string;
  creation_type?: string;
  status?: string;
  source?: string;
  is_internal?: boolean;
  category?: string;
  mode?: string;
  [key: string]: unknown;
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

export interface ListMcpServerToolsOptions {
  /** Read the draft configuration's tools; needs `view` permission on the server. */
  draft?: boolean;
}

/** Discover the MCP protocol tools available through one registered server. */
export function listMcpServerTools(
  ctx: RequestContext,
  mcpId: string,
  opts: ListMcpServerToolsOptions = {},
): Promise<unknown> {
  return request(ctx, `${PATH}/proxy/${encodeURIComponent(mcpId)}/tools`, {
    query: { draft: opts.draft },
    responseParser: parseBigIntJSON,
  });
}
