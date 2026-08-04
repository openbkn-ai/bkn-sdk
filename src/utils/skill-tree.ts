// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * Directory views over a skill's file manifest.
 *
 * The backend manifest is a flat list of archive-relative paths — registration
 * drops zip directory entries — so the folder structure here is inferred from
 * the paths themselves. One consequence is inherent: a directory that holds no
 * files cannot appear, because nothing in the manifest mentions it.
 */
import type { SkillFileEntry } from "../api/skills.js";

export interface SkillDirChild {
  name: string;
  type: "dir";
  /** Files anywhere beneath this directory. */
  files: number;
  /** Total bytes beneath this directory. */
  size: number;
}

export interface SkillFileChild {
  name: string;
  type: "file";
  relPath: string;
  fileType?: string;
  size?: number;
  mime?: string;
}

export type SkillChild = SkillDirChild | SkillFileChild;

/** Strip the surrounding slashes so `/styles/` and `styles` address the same node. */
function normalize(path: string | undefined): string {
  return (path ?? "").replace(/^\/+|\/+$/g, "");
}

function segments(relPath: string): string[] {
  return relPath.split("/").filter(Boolean);
}

/** Whether `path` names a file, a directory, or nothing at all in the manifest. */
export function classifyPath(
  files: SkillFileEntry[],
  path: string | undefined,
): "root" | "dir" | "file" | "missing" {
  const target = normalize(path);
  if (!target) return "root";
  if (files.some((f) => normalize(f.rel_path) === target)) return "file";
  const prefix = `${target}/`;
  return files.some((f) => normalize(f.rel_path).startsWith(prefix)) ? "dir" : "missing";
}

/**
 * Direct children of `path` — one level only, so a caller can walk down a deep
 * skill without pulling every path at once. Directories sort ahead of files.
 */
export function listChildren(files: SkillFileEntry[], path?: string): SkillChild[] {
  const target = normalize(path);
  const prefix = target ? `${target}/` : "";
  const dirs = new Map<string, SkillDirChild>();
  const leaves: SkillFileChild[] = [];

  for (const file of files) {
    const rel = normalize(file.rel_path);
    if (prefix && !rel.startsWith(prefix)) continue;
    const rest = segments(rel.slice(prefix.length));
    if (rest.length === 0) continue;
    const [head] = rest;
    if (!head) continue;
    if (rest.length === 1) {
      leaves.push({
        name: head,
        type: "file",
        relPath: rel,
        fileType: file.file_type,
        size: file.size,
        mime: file.mime_type,
      });
      continue;
    }
    const dir = dirs.get(head) ?? { name: head, type: "dir", files: 0, size: 0 };
    dir.files += 1;
    dir.size += file.size ?? 0;
    dirs.set(head, dir);
  }

  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  return [...[...dirs.values()].sort(byName), ...leaves.sort(byName)];
}

/** Files anywhere under `path` (the whole subtree), for totals. */
export function filesUnder(files: SkillFileEntry[], path?: string): SkillFileEntry[] {
  const target = normalize(path);
  if (!target) return files;
  const prefix = `${target}/`;
  return files.filter((f) => normalize(f.rel_path).startsWith(prefix));
}

interface TreeNode {
  dirs: Map<string, TreeNode>;
  files: SkillFileChild[];
}

function emptyNode(): TreeNode {
  return { dirs: new Map(), files: [] };
}

function buildTree(files: SkillFileEntry[]): TreeNode {
  const root = emptyNode();
  for (const file of files) {
    const parts = segments(normalize(file.rel_path));
    const name = parts.pop();
    if (!name) continue;
    let node = root;
    for (const part of parts) {
      const next = node.dirs.get(part) ?? emptyNode();
      node.dirs.set(part, next);
      node = next;
    }
    node.files.push({
      name,
      type: "file",
      relPath: normalize(file.rel_path),
      fileType: file.file_type,
      size: file.size,
      mime: file.mime_type,
    });
  }
  return root;
}

function renderNode(node: TreeNode, indent: string, out: string[]): void {
  const dirs = [...node.dirs.entries()].sort(([a], [b]) => a.localeCompare(b));
  const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name));
  const total = dirs.length + files.length;
  let index = 0;

  for (const [name, child] of dirs) {
    index += 1;
    const last = index === total;
    out.push(`${indent}${last ? "└── " : "├── "}${name}/`);
    renderNode(child, `${indent}${last ? "    " : "│   "}`, out);
  }
  for (const file of files) {
    index += 1;
    const last = index === total;
    const meta = [file.fileType, file.size === undefined ? undefined : `${file.size} B`]
      .filter(Boolean)
      .join(", ");
    out.push(`${indent}${last ? "└── " : "├── "}${file.name}${meta ? `  (${meta})` : ""}`);
  }
}

/** Full hierarchy of a manifest, rendered as an ASCII tree. */
export function renderTree(files: SkillFileEntry[]): string {
  const out: string[] = [];
  renderNode(buildTree(files), "", out);
  return out.join("\n");
}
