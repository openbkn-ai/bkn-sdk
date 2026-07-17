// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** Context-loader resource surface (MCP over agent-retrieval). */
import {
  type DetailLevel,
  type SearchSchemaOptions,
  callMethod,
  callTool,
  findSkills,
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
  searchSchema,
} from "../api/context-loader.js";
import type { RequestContext } from "../types.js";

export function context(ctx: RequestContext) {
  return {
    searchSchema: (knId: string, query: string, opts?: SearchSchemaOptions) =>
      searchSchema(ctx, knId, query, opts),
    queryObjectInstance: (knId: string, args: Record<string, unknown>) =>
      queryObjectInstance(ctx, knId, args),
    findSkills: (knId: string, objectTypeId: string, topK?: number) =>
      findSkills(ctx, knId, objectTypeId, topK),
    // Progressive schema disclosure: skeleton first (summary), then drill down.
    knDetail: (knId: string, detailLevel?: DetailLevel) => getKnDetail(ctx, knId, detailLevel),
    objectTypes: (knId: string, ids: string[]) => getObjectTypes(ctx, knId, ids),
    relationTypes: (knId: string, ids: string[]) => getRelationTypes(ctx, knId, ids),
    info: () => mcpInfo(ctx),
    tools: (knId: string) => listTools(ctx, knId),
    toolCall: (knId: string, name: string, args: Record<string, unknown>) =>
      callTool(ctx, knId, name, args),
    // Generic MCP method passthrough — covers methods not yet wrapped, so the
    // surface doesn't have to grow every time the server adds one.
    callMethod: (knId: string, method: string, params?: Record<string, unknown>) =>
      callMethod(ctx, knId, method, params),
    queryInstanceSubgraph: (knId: string, args: Record<string, unknown>) =>
      queryInstanceSubgraph(ctx, knId, args),
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
