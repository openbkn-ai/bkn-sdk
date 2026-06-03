/** Agent resource surface (read side + published listing). */
import {
  type ListAgentsOptions,
  type PagingOptions,
  createAgent,
  deleteAgent,
  getAgent,
  getAgentByKey,
  getAgentTemplate,
  listAgentCategories,
  listAgentTemplates,
  listAgents,
  listConversations,
  listMessages,
  listPersonalAgents,
  publishAgent,
  unpublishAgent,
  updateAgent,
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
    create: (body: unknown) => createAgent(ctx, body),
    update: (agentId: string, body: unknown) => updateAgent(ctx, agentId, body),
    delete: (agentId: string) => deleteAgent(ctx, agentId),
    publish: (agentId: string) => publishAgent(ctx, agentId),
    unpublish: (agentId: string) => unpublishAgent(ctx, agentId),
    sessions: (agentKey: string, opts?: { page?: number; size?: number }) =>
      listConversations(ctx, agentKey, opts),
    history: (agentKey: string, conversationId: string) =>
      listMessages(ctx, agentKey, conversationId),
  };
}
