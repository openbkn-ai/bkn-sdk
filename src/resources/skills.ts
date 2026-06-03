/** Skill registry/market resource surface (read + delete). */
import {
  type ListSkillsOptions,
  deleteSkill,
  getSkill,
  getSkillMarket,
  listSkillMarket,
  listSkills,
} from "../api/skills.js";
import type { RequestContext } from "../types.js";

export function skills(ctx: RequestContext) {
  return {
    list: (opts?: ListSkillsOptions) => listSkills(ctx, opts),
    get: (skillId: string) => getSkill(ctx, skillId),
    market: (opts?: ListSkillsOptions) => listSkillMarket(ctx, opts),
    marketGet: (skillId: string) => getSkillMarket(ctx, skillId),
    delete: (skillId: string) => deleteSkill(ctx, skillId),
  };
}
