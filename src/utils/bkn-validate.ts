// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the OpenBKN License. See the LICENSE file in the project root.

/**
 * Structural validation of a local BKN directory. This is a slim, dependency-free
 * check (the full network model is not vendored): it parses the
 * frontmatter of every `.bkn` file and verifies the network is internally
 * consistent enough to push — required files, well-formed frontmatter, object-type
 * name limits, unique ids, and relation endpoints that reference real object types.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// validateObjectName parity: ISF caps BKN object names at 40 utf-8 codepoints.
export const BKN_OBJECT_NAME_MAX_LENGTH = 40;

export interface ValidationResult {
  valid: boolean;
  dir: string;
  counts: { objectTypes: number; relationTypes: number; conceptGroups: number };
  errors: string[];
  warnings: string[];
}

interface Frontmatter {
  type?: string;
  id?: string;
  name?: string;
}

/** Parse a leading `--- ... ---` YAML-ish frontmatter block (flat scalars only). */
function parseFrontmatter(text: string): Frontmatter | null {
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return null;
  const block = text.slice(3, end);
  const fm: Frontmatter = {};
  for (const line of block.split("\n")) {
    const m = line.match(/^\s*(type|id|name)\s*:\s*(.+?)\s*$/);
    if (m?.[1]) fm[m[1] as keyof Frontmatter] = m[2]?.replace(/^["']|["']$/g, "");
  }
  return fm;
}

function bknFiles(dir: string): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".bkn"))
    .map((f) => join(dir, f));
}

/** Pull (source, target) object-type ids out of a relation file's Endpoint table. */
function endpointRefs(text: string): Array<{ source: string; target: string }> {
  const refs: Array<{ source: string; target: string }> = [];
  const idx = text.indexOf("### Endpoint");
  if (idx === -1) return refs;
  // Only the Endpoint section — stop at the next heading (e.g. Mapping Rules).
  const after = text.slice(idx + "### Endpoint".length);
  const next = after.indexOf("\n###");
  const section = next === -1 ? after : after.slice(0, next);
  for (const line of section.split("\n")) {
    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter(Boolean);
    if (cells.length < 2) continue;
    const [source, target] = cells;
    if (!source || !target) continue;
    if (/^source$/i.test(source) || /^-+$/.test(source)) continue; // header / divider
    refs.push({ source, target });
  }
  return refs;
}

export function validateBknDirectory(dirPath: string): ValidationResult {
  const dir = resolve(dirPath);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return {
      valid: false,
      dir,
      counts: { objectTypes: 0, relationTypes: 0, conceptGroups: 0 },
      errors: [`Not a directory: ${dir}`],
      warnings: [],
    };
  }

  // network.bkn — required, must declare a knowledge_network.
  const networkPath = join(dir, "network.bkn");
  if (!existsSync(networkPath)) {
    errors.push("Missing network.bkn at the BKN root.");
  } else {
    const fm = parseFrontmatter(readFileSync(networkPath, "utf8"));
    if (!fm) errors.push("network.bkn has no frontmatter block.");
    else {
      if (fm.type !== "knowledge_network")
        errors.push(`network.bkn type must be 'knowledge_network', got '${fm.type ?? ""}'.`);
      if (!fm.id) errors.push("network.bkn is missing 'id'.");
      if (!fm.name) errors.push("network.bkn is missing 'name'.");
    }
  }

  // Object types.
  const otIds = new Set<string>();
  const otFiles = bknFiles(join(dir, "object_types"));
  for (const file of otFiles) {
    const fm = parseFrontmatter(readFileSync(file, "utf8"));
    const rel = file.slice(dir.length + 1);
    if (!fm || fm.type !== "object_type") {
      errors.push(`${rel}: not a valid object_type (missing/wrong frontmatter type).`);
      continue;
    }
    if (!fm.id) errors.push(`${rel}: object_type missing 'id'.`);
    if (!fm.name) errors.push(`${rel}: object_type missing 'name'.`);
    if (fm.name && [...fm.name].length > BKN_OBJECT_NAME_MAX_LENGTH) {
      errors.push(
        `${rel}: object_type name exceeds ${BKN_OBJECT_NAME_MAX_LENGTH} codepoints ('${fm.name}').`,
      );
    }
    if (fm.id) {
      if (otIds.has(fm.id)) errors.push(`Duplicate object_type id '${fm.id}'.`);
      otIds.add(fm.id);
    }
  }

  // Relation types — validate frontmatter + endpoint references.
  const rtFiles = bknFiles(join(dir, "relation_types"));
  for (const file of rtFiles) {
    const text = readFileSync(file, "utf8");
    const fm = parseFrontmatter(text);
    const rel = file.slice(dir.length + 1);
    if (!fm || fm.type !== "relation_type") {
      errors.push(`${rel}: not a valid relation_type (missing/wrong frontmatter type).`);
      continue;
    }
    if (!fm.id) errors.push(`${rel}: relation_type missing 'id'.`);
    for (const { source, target } of endpointRefs(text)) {
      if (otIds.size > 0 && !otIds.has(source))
        warnings.push(`${rel}: endpoint source '${source}' is not a known object_type.`);
      if (otIds.size > 0 && !otIds.has(target))
        warnings.push(`${rel}: endpoint target '${target}' is not a known object_type.`);
    }
  }

  const cgFiles = bknFiles(join(dir, "concept_groups"));

  return {
    valid: errors.length === 0,
    dir,
    counts: {
      objectTypes: otFiles.length,
      relationTypes: rtFiles.length,
      conceptGroups: cgFiles.length,
    },
    errors,
    warnings,
  };
}
