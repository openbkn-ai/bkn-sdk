/** Agent resource surface (read side + published listing). */
import {
  type ListAgentsOptions,
  type PagingOptions,
  getAgent,
  getAgentByKey,
  getAgentTemplate,
  listAgentCategories,
  listAgentTemplates,
  listAgents,
  listPersonalAgents,
} from "../api/agents.js";
import type { RequestContext } from "../types.js";

export function agents(ctx: RequestContext) {
  return {
    list: (opts?: ListAgentsOptions) => listAgents(ctx, opts),
    get: (agentId: string) => getAgent(ctx, agentId),
    getByKey: (key: string) => getAgentByKey(ctx, key),
    personalList: (opts?: PagingOptions) => listPersonalAgents(ctx, opts),
    templateList: (opts?: PagingOptions) => listAgentTemplates(ctx, opts),
    templateGet: (templateId: string) => getAgentTemplate(ctx, templateId),
    categoryList: () => listAgentCategories(ctx),
  };
}
