// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * Structural validation of a local BKN directory. This is a slim, dependency-free
 * check (the full network model is not vendored): it parses the
 * frontmatter of every `.bkn` file and verifies the network is internally
 * consistent enough to push — required files, well-formed frontmatter, object-type
 * name limits, unique ids, and relation endpoints that reference real object types.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { DataPropertyMaskRule } from "../types.js";

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

interface DataPropertyRow {
  Name?: string;
  Type?: string;
  "Mask Rule"?: string;
}

const STRING_MASK_TYPES = new Set(["string", "text", "keyword"]);
const NUMBER_MASK_TYPES = new Set(["integer", "unsigned integer", "float", "decimal"]);
const DATE_MASK_GRANULARITIES: Readonly<Record<string, ReadonlySet<string>>> = {
  date: new Set(["year", "month"]),
  time: new Set(["hour"]),
  datetime: new Set(["year", "month", "day", "hour"]),
  timestamp: new Set(["year", "month", "day", "hour"]),
};
const PRINTABLE_CODE_POINT = /^[\p{L}\p{M}\p{N}\p{P}\p{S}\p{Zs}]$/u;

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

function markdownSection(text: string, heading: string): string | undefined {
  const pattern = new RegExp(`^###\\s+${heading}\\s*$`, "m");
  const match = pattern.exec(text);
  if (!match) return undefined;
  const after = text.slice(match.index + match[0].length);
  const next = /^###\s+/m.exec(after);
  return next ? after.slice(0, next.index) : after;
}

function markdownTable(section: string): Array<Record<string, string>> {
  const lines = section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|"));
  if (lines.length < 2) return [];

  const split = (line: string): string[] =>
    line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());
  const headers = split(lines[0] ?? "");
  const divider = /^:?-+:?$/;
  const dataStart = split(lines[1] ?? "").every((cell) => divider.test(cell)) ? 2 : 1;

  return lines.slice(dataStart).map((line) => {
    const cells = split(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
  });
}

function expectKeys(rule: Record<string, unknown>, allowed: readonly string[]): string | undefined {
  const allowedSet = new Set(["kind", ...allowed]);
  const unknown = Object.keys(rule).find((key) => !allowedSet.has(key));
  return unknown ? `unknown field '${unknown}'` : undefined;
}

function replacementError(value: unknown): string | undefined {
  if (typeof value !== "string") return "replacement must be a string";
  const codePoints = [...value];
  if (codePoints.length < 1 || codePoints.length > 8) {
    return "replacement must contain 1 to 8 Unicode code points";
  }
  if (!codePoints.every((codePoint) => PRINTABLE_CODE_POINT.test(codePoint))) {
    return "replacement must contain only printable Unicode code points";
  }
  return undefined;
}

function boundedIntegerError(name: string, value: unknown): string | undefined {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 64) {
    return `${name} must be an integer between 0 and 64`;
  }
  return undefined;
}

function incompatible(kind: string, propertyType: string): string {
  return `mask rule kind '${kind}' does not support property type '${propertyType}'`;
}

function validateMaskRule(propertyType: string, value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "Mask Rule must be a JSON object";
  }
  const rule = value as Record<string, unknown>;
  const kind = rule.kind;
  if (typeof kind !== "string") return "kind is required and must be a string";

  let error: string | undefined;
  switch (kind) {
    case "fixed":
      if (!STRING_MASK_TYPES.has(propertyType)) return incompatible(kind, propertyType);
      return expectKeys(rule, ["replacement"]) ?? replacementError(rule.replacement);
    case "partial":
      if (!STRING_MASK_TYPES.has(propertyType)) return incompatible(kind, propertyType);
      error = expectKeys(rule, ["keep_start", "keep_end", "replacement"]);
      if (error) return error;
      return (
        boundedIntegerError("keep_start", rule.keep_start) ??
        boundedIntegerError("keep_end", rule.keep_end) ??
        replacementError(rule.replacement)
      );
    case "email":
      if (!STRING_MASK_TYPES.has(propertyType)) return incompatible(kind, propertyType);
      error = expectKeys(rule, ["local_keep_start", "preserve_domain", "replacement"]);
      if (error) return error;
      if (typeof rule.preserve_domain !== "boolean") {
        return "preserve_domain is required and must be a boolean";
      }
      return (
        boundedIntegerError("local_keep_start", rule.local_keep_start) ??
        replacementError(rule.replacement)
      );
    case "round":
      if (!NUMBER_MASK_TYPES.has(propertyType)) return incompatible(kind, propertyType);
      error = expectKeys(rule, ["step"]);
      if (error) return error;
      if (typeof rule.step !== "number" || !Number.isFinite(rule.step) || rule.step <= 0) {
        return "step must be a finite number greater than 0";
      }
      return undefined;
    case "date_granularity": {
      const granularities = DATE_MASK_GRANULARITIES[propertyType];
      if (!granularities) return incompatible(kind, propertyType);
      error = expectKeys(rule, ["granularity"]);
      if (error) return error;
      if (typeof rule.granularity !== "string" || !granularities.has(rule.granularity)) {
        return `granularity '${String(rule.granularity ?? "")}' is not coarser than property type '${propertyType}'`;
      }
      return undefined;
    }
    default:
      return `unsupported mask rule kind '${kind}'`;
  }
}

function validateDataPropertyMaskRules(text: string, rel: string): string[] {
  const section = markdownSection(text, "Data Properties");
  if (!section) return [];

  const errors: string[] = [];
  for (const row of markdownTable(section) as DataPropertyRow[]) {
    const rawRule = row["Mask Rule"]?.trim();
    if (!rawRule) continue;
    const propertyName = row.Name?.trim() || "<unnamed>";
    const propertyType = row.Type?.trim() || "";
    let parsed: DataPropertyMaskRule;
    try {
      parsed = JSON.parse(rawRule) as DataPropertyMaskRule;
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      errors.push(`${rel}: data property '${propertyName}' has invalid Mask Rule JSON: ${detail}`);
      continue;
    }
    const error = validateMaskRule(propertyType, parsed);
    if (error)
      errors.push(`${rel}: data property '${propertyName}' has invalid Mask Rule: ${error}.`);
  }
  return errors;
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
    const text = readFileSync(file, "utf8");
    const fm = parseFrontmatter(text);
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
    errors.push(...validateDataPropertyMaskRules(text, rel));
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
