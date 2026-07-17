// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * Render a department hierarchy as text. The tree itself is built by
 * `buildDepartmentTree` in `../api/safe.js` (nests on bkn-safe's `parent_id`);
 * the ISF `parent_deps[]` builder that used to live here went with ISF.
 */

export interface OrgNode {
  id: string;
  name: string;
  children: OrgNode[];
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
