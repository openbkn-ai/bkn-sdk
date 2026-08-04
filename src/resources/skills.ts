// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** Skill registry/market resource surface (read, delete, package register/download/install). */
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import {
  type ExecuteSkillOptions,
  type ListSkillsOptions,
  type SkillFileEntry,
  type SkillStatus,
  type SkillView,
  deleteSkill,
  downloadSkill,
  executeSkill,
  getSkill,
  getSkillContent,
  getSkillHistory,
  getSkillMarket,
  getSkillNames,
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
import { InputError } from "../utils/errors.js";
import { unzipToDirectory, unzipToMap, zipDirectory } from "../utils/skill-archive.js";
import { classifyPath, filesUnder, listChildren } from "../utils/skill-tree.js";

/** Which version a read targets: the published release, or the editable draft. */
export interface SkillViewOptions {
  draft?: boolean;
}

function viewOf(opts: SkillViewOptions | undefined): SkillView {
  return opts?.draft ? "draft" : "published";
}

/**
 * Unpacked archives, keyed by platform + skill + view. A single archive backs
 * every file read in a run, so reading ten files costs one download rather than
 * ten. Keyed per view because the draft and the release differ.
 */
const archiveCache = new Map<string, Promise<Map<string, Uint8Array>>>();

function cachedArchive(
  ctx: RequestContext,
  skillId: string,
  view: SkillView,
): Promise<Map<string, Uint8Array>> {
  const key = `${ctx.baseUrl}|${skillId}|${view}`;
  const hit = archiveCache.get(key);
  if (hit) return hit;
  const pending = downloadSkill(ctx, skillId, view).then(unzipToMap);
  archiveCache.set(key, pending);
  // A failed download must not poison later attempts.
  pending.catch(() => archiveCache.delete(key));
  return pending;
}

function binaryError(relPath: string): InputError {
  return new InputError(
    `'${relPath}' is a binary file — use \`openbkn skill install\` or \`skill download\` to fetch it.`,
  );
}

/**
 * Text the caller can safely write to a terminal or a file, or nothing.
 *
 * A strict decode rejects any byte sequence that isn't UTF-8, which is what
 * separates a document from an image here. NUL is checked separately: it
 * decodes cleanly but never appears in real text.
 */
function decodeStrict(bytes: Uint8Array, relPath: string): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw binaryError(relPath);
  }
  if (text.includes("\u0000")) throw binaryError(relPath);
  return text;
}

/**
 * The backend inlines file bodies into JSON, so a binary file arrives already
 * lossily decoded — the original bytes are gone and U+FFFD marks where they
 * were. Printing that would emit mojibake, so treat it as binary.
 */
function looksLossy(text: string): boolean {
  return text.includes("\u0000") || text.includes("\uFFFD");
}

/**
 * File body, whatever the deploy supports.
 *
 * Preferred path: ask the backend to inline the content. Only the management
 * (draft) surface honours that today; the consumer surface answers with a
 * pre-signed object-store URL whose host resolves inside the cluster only, so
 * an outside caller can't follow it. When that happens, fall back to the
 * archive, which is served through the same ingress the CLI already reached.
 */
async function readFileText(
  ctx: RequestContext,
  skillId: string,
  relPath: string,
  view: SkillView,
): Promise<string> {
  const res = await readSkillFile(ctx, skillId, relPath, { view, responseMode: "content" });
  if (typeof res?.content === "string" && res.content.length > 0) {
    if (looksLossy(res.content)) throw binaryError(relPath);
    return res.content;
  }
  const archive = await cachedArchive(ctx, skillId, view);
  const bytes = archive.get(relPath);
  if (!bytes) {
    throw new InputError(`'${relPath}' not found in skill ${skillId}.`);
  }
  return decodeStrict(bytes, relPath);
}

export function skills(ctx: RequestContext) {
  const manifest = async (skillId: string, opts?: SkillViewOptions): Promise<SkillFileEntry[]> => {
    const res = await getSkillContent(ctx, skillId, { view: viewOf(opts) });
    return res?.files ?? [];
  };

  return {
    list: (opts?: ListSkillsOptions) => listSkills(ctx, opts),
    get: (skillId: string) => getSkill(ctx, skillId),
    market: (opts?: ListSkillsOptions) => listSkillMarket(ctx, opts),
    marketGet: (skillId: string) => getSkillMarket(ctx, skillId),
    delete: (skillId: string) => deleteSkill(ctx, skillId),
    content: (skillId: string, opts?: SkillViewOptions) =>
      getSkillContent(ctx, skillId, { view: viewOf(opts) }),
    readFile: (skillId: string, relPath: string, opts?: SkillViewOptions) =>
      readSkillFile(ctx, skillId, relPath, { view: viewOf(opts) }),
    /** SKILL.md's own text, for callers that want the document rather than a link. */
    contentRaw: (skillId: string, opts?: SkillViewOptions) =>
      readFileText(ctx, skillId, "SKILL.md", viewOf(opts)),
    /** A bundled file's text. */
    readFileRaw: (skillId: string, relPath: string, opts?: SkillViewOptions) =>
      readFileText(ctx, skillId, relPath, viewOf(opts)),
    /** Run the skill in the platform sandbox. */
    execute: (skillId: string, opts: ExecuteSkillOptions) => executeSkill(ctx, skillId, opts),
    /** Resolve skill ids to names; unknown ids are simply absent from the result. */
    names: (ids: string[]) => getSkillNames(ctx, ids),
    /**
     * One level of the skill's file tree. Directories are inferred from the
     * manifest's paths — see utils/skill-tree.
     */
    files: async (skillId: string, path?: string, opts?: SkillViewOptions) => {
      const files = await manifest(skillId, opts);
      const kind = classifyPath(files, path);
      if (kind === "file") {
        throw new InputError(`'${path}' is a file, not a directory — use \`skill read-file\`.`);
      }
      if (kind === "missing") {
        throw new InputError(`'${path}' not found in skill ${skillId}.`);
      }
      const subtree = filesUnder(files, path);
      return {
        skillId,
        path: path ?? "",
        entries: listChildren(files, path),
        totalFiles: subtree.length,
        totalSize: subtree.reduce((sum, f) => sum + (f.size ?? 0), 0),
      };
    },
    /** The manifest itself, for callers that want to render the whole tree. */
    fileManifest: manifest,
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
    download: async (skillId: string, outPath?: string, opts?: SkillViewOptions) => {
      const bytes = await downloadSkill(ctx, skillId, viewOf(opts));
      const dest = resolve(outPath ?? `${skillId}.zip`);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, bytes);
      return { skillId, path: dest, bytes: bytes.length };
    },
    /** Download a skill archive and extract it into a directory. */
    install: async (skillId: string, dir?: string, opts?: SkillViewOptions) => {
      const bytes = await downloadSkill(ctx, skillId, viewOf(opts));
      const target = resolve(dir ?? skillId);
      const files = await unzipToDirectory(bytes, target);
      return { skillId, dir: target, files: files.length };
    },
  };
}
