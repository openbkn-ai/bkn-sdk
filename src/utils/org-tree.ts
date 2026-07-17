// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** Build / render a department hierarchy from flat ISF search entries. */
import type { DeptEntry } from "../api/admin.js";

export interface OrgNode {
  id: string;
  name: string;
  children: OrgNode[];
}

/** Nest flat departments by their `parent_deps` chain (last dep = immediate parent). */
export function buildOrgTree(entries: DeptEntry[]): OrgNode[] {
  const nodes = new Map<string, OrgNode>();
  for (const e of entries) nodes.set(e.id, { id: e.id, name: e.name ?? e.id, children: [] });

  const roots: OrgNode[] = [];
  for (const e of entries) {
    const node = nodes.get(e.id);
    if (!node) continue;
    const deps = e.parent_deps;
    const parentId = deps && deps.length > 0 ? deps[deps.length - 1]?.id : undefined;
    const parent = parentId ? nodes.get(parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/** Render a tree as indented text (`├── name (id: …)`). */
export function renderOrgTree(nodes: OrgNode[], prefix = ""): string {
  const lines: string[] = [];
  nodes.forEach((node, i) => {
    const last = i === nodes.length - 1;
    lines.push(`${prefix}${last ? "└── " : "├── "}${node.name} (id: ${node.id})`);
    if (node.children.length) {
      lines.push(renderOrgTree(node.children, `${prefix}${last ? "    " : "│   "}`));
    }
  });
  return lines.join("\n");
}
