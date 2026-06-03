/** Skill registry/market resource surface (read + delete). */
import {
  type ListSkillsOptions,
  type SkillStatus,
  deleteSkill,
  getSkill,
  getSkillContent,
  getSkillHistory,
  getSkillMarket,
  listSkillMarket,
  listSkills,
  readSkillFile,
  setSkillStatus,
} from "../api/skills.js";
import type { RequestContext } from "../types.js";

export function skills(ctx: RequestContext) {
  return {
    list: (opts?: ListSkillsOptions) => listSkills(ctx, opts),
    get: (skillId: string) => getSkill(ctx, skillId),
    market: (opts?: ListSkillsOptions) => listSkillMarket(ctx, opts),
    marketGet: (skillId: string) => getSkillMarket(ctx, skillId),
    delete: (skillId: string) => deleteSkill(ctx, skillId),
    content: (skillId: string) => getSkillContent(ctx, skillId),
    readFile: (skillId: string, relPath: string) => readSkillFile(ctx, skillId, relPath),
    history: (skillId: string) => getSkillHistory(ctx, skillId),
    setStatus: (skillId: string, status: SkillStatus) => setSkillStatus(ctx, skillId, status),
  };
}
