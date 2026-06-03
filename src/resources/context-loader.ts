/** Context-loader resource surface (MCP over agent-retrieval). */
import {
  type SearchSchemaOptions,
  callTool,
  findSkills,
  listTools,
  queryObjectInstance,
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
    tools: (knId: string) => listTools(ctx, knId),
    toolCall: (knId: string, name: string, args: Record<string, unknown>) =>
      callTool(ctx, knId, name, args),
  };
}
