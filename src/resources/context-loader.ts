// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** Context-loader resource surface (MCP over agent-retrieval). */
import {
  type DetailLevel,
  type RunCypherOptions,
  type SearchSchemaOptions,
  type ToolCallOptions,
  callManagedTool,
  callMethod,
  callTool,
  getActionInfo,
  getKnDetail,
  getLogicProperties,
  getObjectTypes,
  getPrompt,
  getRelationTypes,
  listPrompts,
  listResourceTemplates,
  listResources,
  listTools,
  mcpInfo,
  queryInstanceSubgraph,
  queryObjectInstance,
  readResource,
  runCypher,
  searchCapabilities,
  searchSchema,
} from "../api/context-loader.js";
import { getSchemaItem } from "../api/knowledge-networks.js";
import type { RequestContext } from "../types.js";
import { isDryRun, previewRequest } from "../utils/dry-run.js";
import {
  validateQueryObjectInstanceArgs,
  validateRequestedProperties,
} from "../utils/query-object-instance-args.js";

export function context(ctx: RequestContext) {
  return {
    searchSchema: (knId: string, query: string, opts?: SearchSchemaOptions) =>
      searchSchema(ctx, knId, query, opts),
    queryObjectInstance: async (knId: string, args: Record<string, unknown>) => {
      validateQueryObjectInstanceArgs(args, knId);
      const properties = args.properties as string[] | undefined;
      if (isDryRun()) {
        previewRequest({
          method: "POST",
          url: new URL("/api/agent-retrieval/v1/mcp", ctx.baseUrl),
          headers: {
            authorization: `Bearer ${ctx.token}`,
            "content-type": "application/json",
            "x-kn-id": knId,
          },
          body: {
            jsonrpc: "2.0",
            method: "tools/call",
            params: {
              name: "query_object_instance",
              arguments: { ...args, kn_id: knId },
            },
          },
        });
      }
      if (properties?.length) {
        const schema = await getSchemaItem(ctx, knId, "object-types", args.ot_id as string);
        validateRequestedProperties(args.ot_id as string, properties, schema);
      }
      return queryObjectInstance(ctx, knId, args);
    },
    searchCapabilities: (knId: string, opts?: Parameters<typeof searchCapabilities>[2]) =>
      searchCapabilities(ctx, knId, opts),
    // Progressive schema disclosure: skeleton first (summary), then drill down.
    knDetail: (knId: string, detailLevel?: DetailLevel) => getKnDetail(ctx, knId, detailLevel),
    objectTypes: (knId: string, ids: string[]) => getObjectTypes(ctx, knId, ids),
    relationTypes: (knId: string, ids: string[]) => getRelationTypes(ctx, knId, ids),
    info: () => mcpInfo(ctx),
    tools: (knId: string) => listTools(ctx, knId),
    toolCall: (
      knId: string,
      name: string,
      args: Record<string, unknown>,
      options?: ToolCallOptions,
    ) => callTool(ctx, knId, name, args, options),
    managedToolCall: <T = unknown>(
      knId: string,
      name: string,
      args: Record<string, unknown>,
      options?: ToolCallOptions,
    ) => callManagedTool<T>(ctx, knId, name, args, options),
    // Generic MCP method passthrough — covers methods not yet wrapped, so the
    // surface doesn't have to grow every time the server adds one.
    callMethod: (knId: string, method: string, params?: Record<string, unknown>) =>
      callMethod(ctx, knId, method, params),
    queryInstanceSubgraph: (knId: string, args: Record<string, unknown>) =>
      queryInstanceSubgraph(ctx, knId, args),
    runCypher: (knId: string, query: string, opts?: RunCypherOptions) =>
      runCypher(ctx, knId, query, opts),
    logicProperties: (knId: string, args: Record<string, unknown>) =>
      getLogicProperties(ctx, knId, args),
    actionInfo: (knId: string, args: Record<string, unknown>) => getActionInfo(ctx, knId, args),
    resources: (knId: string) => listResources(ctx, knId),
    resource: (knId: string, uri: string) => readResource(ctx, knId, uri),
    templates: (knId: string) => listResourceTemplates(ctx, knId),
    prompts: (knId: string) => listPrompts(ctx, knId),
    prompt: (knId: string, name: string, args?: Record<string, unknown>) =>
      getPrompt(ctx, knId, name, args),
  };
}
