import { type SendChatOptions, fetchAgentInfo, sendChat } from "../api/agent-chat.js";
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

/** Read the agent's skill-member array (config.skills.skills), or []. */
function skillMembers(agent: Record<string, unknown>): unknown[] {
  const config = (agent.config ?? {}) as Record<string, unknown>;
  const skills = (config.skills ?? {}) as Record<string, unknown>;
  return Array.isArray(skills.skills) ? skills.skills : [];
}
/** Write the agent's skill-member array back into config.skills.skills. */
function setSkillMembers(agent: Record<string, unknown>, members: unknown[]): void {
  const config = (agent.config ?? (agent.config = {})) as Record<string, unknown>;
  const skills = (config.skills ?? (config.skills = {})) as Record<string, unknown>;
  skills.skills = members;
}

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
    /** List skill ids attached to an agent (config.skills.skills). */
    skillList: async (agentId: string): Promise<string[]> => {
      const agent = (await getAgent(ctx, agentId)) as Record<string, unknown>;
      const arr = skillMembers(agent);
      return arr.map((m) => String((m as Record<string, unknown>).skill_id ?? "")).filter(Boolean);
    },
    /** Attach skill(s) to an agent (dedup), then persist. */
    skillAdd: async (agentId: string, skillIds: string[]): Promise<unknown> => {
      const agent = (await getAgent(ctx, agentId)) as Record<string, unknown>;
      const arr = skillMembers(agent);
      const have = new Set(arr.map((m) => String((m as Record<string, unknown>).skill_id ?? "")));
      for (const id of skillIds) if (!have.has(id)) arr.push({ skill_id: id });
      setSkillMembers(agent, arr);
      return updateAgent(ctx, agentId, agent);
    },
    /** Detach skill(s) from an agent, then persist. */
    skillRemove: async (agentId: string, skillIds: string[]): Promise<unknown> => {
      const agent = (await getAgent(ctx, agentId)) as Record<string, unknown>;
      const drop = new Set(skillIds);
      const arr = skillMembers(agent).filter(
        (m) => !drop.has(String((m as Record<string, unknown>).skill_id ?? "")),
      );
      setSkillMembers(agent, arr);
      return updateAgent(ctx, agentId, agent);
    },
    /** Send a chat turn to an agent (resolves agent id/key/version first). */
    chat: async (
      agentId: string,
      query: string,
      opts: SendChatOptions & { version?: string } = {},
    ) => {
      const info = await fetchAgentInfo(ctx, agentId, opts.version ?? "v0");
      return sendChat(ctx, info, query, opts);
    },
  };
}
