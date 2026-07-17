// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** Skill registry/market resource surface (read, delete, package register/download/install). */
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import {
  type ListSkillsOptions,
  type SkillStatus,
  deleteSkill,
  downloadSkill,
  getSkill,
  getSkillContent,
  getSkillHistory,
  getSkillMarket,
  listSkillMarket,
  listSkills,
  publishSkillVersion,
  readSkillFile,
  registerSkillZip,
  republishSkillVersion,
  setSkillStatus,
  updateSkillMetadata,
  updateSkillPackageZip,
} from "../api/skills.js";
import type { RequestContext } from "../types.js";
import { unzipToDirectory, zipDirectory } from "../utils/skill-archive.js";

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
    updateMetadata: (skillId: string, body: unknown) => updateSkillMetadata(ctx, skillId, body),
    republish: (skillId: string, version: string) => republishSkillVersion(ctx, skillId, version),
    publishHistory: (skillId: string, version: string) =>
      publishSkillVersion(ctx, skillId, version),
    /** Zip a local skill directory and register it. */
    register: async (dir: string, opts?: { source?: string; extendInfo?: unknown }) =>
      registerSkillZip(ctx, await zipDirectory(dir), {
        filename: `${basename(resolve(dir))}.zip`,
        ...opts,
      }),
    /** Replace a skill's package from a local directory. */
    updatePackage: async (skillId: string, dir: string) =>
      updateSkillPackageZip(ctx, skillId, await zipDirectory(dir), `${basename(resolve(dir))}.zip`),
    /** Download a skill archive to a local .zip file. */
    download: async (skillId: string, outPath?: string) => {
      const bytes = await downloadSkill(ctx, skillId);
      const dest = resolve(outPath ?? `${skillId}.zip`);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, bytes);
      return { skillId, path: dest, bytes: bytes.length };
    },
    /** Download a skill archive and extract it into a directory. */
    install: async (skillId: string, dir?: string) => {
      const bytes = await downloadSkill(ctx, skillId);
      const target = resolve(dir ?? skillId);
      const files = await unzipToDirectory(bytes, target);
      return { skillId, dir: target, files: files.length };
    },
  };
}
