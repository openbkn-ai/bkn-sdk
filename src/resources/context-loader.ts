/** Context-loader resource surface (MCP over agent-retrieval). */
import {
  type SearchSchemaOptions,
  callTool,
  findSkills,
  getPrompt,
  listPrompts,
  listResourceTemplates,
  listResources,
  listTools,
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
    tools: (knId: string) => listTools(ctx, knId),
    toolCall: (knId: string, name: string, args: Record<string, unknown>) =>
      callTool(ctx, knId, name, args),
    resources: (knId: string) => listResources(ctx, knId),
    resource: (knId: string, uri: string) => readResource(ctx, knId, uri),
    templates: (knId: string) => listResourceTemplates(ctx, knId),
    prompts: (knId: string) => listPrompts(ctx, knId),
    prompt: (knId: string, name: string, args?: Record<string, unknown>) =>
      getPrompt(ctx, knId, name, args),
  };
}
