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
import yaml from "js-yaml";
import type { DataPropertyMaskRule } from "../types.js";

// validateObjectName parity: ISF caps BKN object names at 40 utf-8 codepoints.
export const BKN_OBJECT_NAME_MAX_LENGTH = 40;

/**
 * A declared capability that push is certain to leave unbound, on whatever platform receives
 * it. Same shape and reason codes as the `capabilities.skipped` entries push answers with.
 */
export interface CapabilitySkipPreview {
  capability_type: "skill" | "function" | "mcp_tool";
  name?: string;
  reason: "not_found";
  detail: string;
}

export interface CapabilityCheck {
  /** Entries declared across skills, functions and mcp_tools. */
  declared: number;
  /** Set when the section cannot be decoded: push then drops all of it, silently. */
  malformed?: string;
  skipped: CapabilitySkipPreview[];
}

export interface ValidationResult {
  valid: boolean;
  dir: string;
  counts: { objectTypes: number; relationTypes: number; conceptGroups: number };
  /** network.bkn's `capabilities:` section: how many entries it declares, and which cannot bind. */
  capabilities: CapabilityCheck;
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
    const propertyType = row.Type?.trim().toLowerCase() || "";
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

const CAPABILITY_LISTS = {
  skills: "skill",
  functions: "function",
  mcp_tools: "mcp_tool",
} as const;

function field(entry: Record<string, unknown>, key: string): string {
  const value = entry[key];
  return value === undefined || value === null ? "" : String(value).trim();
}

/**
 * Check network.bkn's `capabilities:` section the way bkn-backend reads it on import.
 *
 * The import never fails over this section. A section it cannot decode is dropped whole —
 * push then reports nothing bound and nothing skipped — and an entry it cannot resolve is
 * skipped. Only what holds on every platform is decided here: a malformed section or key,
 * and an entry with neither ids nor names to resolve by. Entries that carry ids alone are
 * warned about, since ids are local to the platform that exported them.
 */
function checkCapabilities(text: string, warnings: string[]): CapabilityCheck {
  const result: CapabilityCheck = { declared: 0, skipped: [] };
  if (!text.startsWith("---")) return result;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return result;
  let frontmatter: unknown;
  try {
    frontmatter = yaml.load(text.slice(3, end));
  } catch {
    return result;
  }
  if (!frontmatter || typeof frontmatter !== "object") return result;
  const section = (frontmatter as Record<string, unknown>).capabilities;
  if (section === undefined || section === null) return result;

  const malformed = (detail: string): CapabilityCheck => {
    warnings.push(`network.bkn: capabilities ${detail}; push ignores the whole section.`);
    return { declared: 0, malformed: detail, skipped: [] };
  };
  if (typeof section !== "object" || Array.isArray(section)) {
    return malformed("is not a mapping of skills / functions / mcp_tools");
  }
  const lists = section as Record<string, unknown>;
  for (const [key, value] of Object.entries(lists)) {
    if (!(key in CAPABILITY_LISTS)) {
      warnings.push(
        `network.bkn: capabilities.${key} is not a known list (skills, functions, mcp_tools); push ignores it.`,
      );
      continue;
    }
    if (value === null || value === undefined) continue;
    if (!Array.isArray(value)) return malformed(`.${key} is not a list`);
    if (value.some((item) => item !== null && (typeof item !== "object" || Array.isArray(item)))) {
      return malformed(`.${key} has an entry that is not a mapping`);
    }
  }

  for (const [key, type] of Object.entries(CAPABILITY_LISTS)) {
    const entries = (lists[key] as Array<Record<string, unknown> | null> | undefined) ?? [];
    for (const entry of entries) {
      if (!entry) continue;
      result.declared += 1;
      const skip = (name: string, detail: string) =>
        result.skipped.push({
          capability_type: type,
          ...(name ? { name } : {}),
          reason: "not_found",
          detail,
        });
      const idsOnly = (label: string) =>
        warnings.push(
          `network.bkn: capabilities.${key} entry '${label}' has ids but no names; it binds only on the platform it was exported from.`,
        );
      if (type === "skill") {
        const [id, name] = [field(entry, "id"), field(entry, "name")];
        if (!id && !name) skip("", "a skill needs an id or a name");
        else if (!name) idsOnly(id);
      } else if (type === "function") {
        const [boxId, toolId] = [field(entry, "box_id"), field(entry, "tool_id")];
        const [boxName, toolName] = [field(entry, "box_name"), field(entry, "tool_name")];
        const label = toolName || toolId;
        if (!(boxId && toolId) && !(boxName && toolName)) {
          skip(label, "a function needs box_id with tool_id, or box_name with tool_name");
        } else if (!(boxName && toolName)) idsOnly(label);
      } else {
        const [mcpId, mcpName] = [field(entry, "mcp_id"), field(entry, "mcp_name")];
        const toolName = field(entry, "tool_name");
        if (!toolName) skip("", "an mcp tool needs tool_name");
        else if (!mcpId && !mcpName) skip(toolName, "an mcp tool needs mcp_id or mcp_name");
        else if (!mcpName) idsOnly(toolName);
      }
    }
  }
  for (const s of result.skipped) {
    warnings.push(
      `network.bkn: push will skip ${s.capability_type} ${s.name ? `'${s.name}'` : "(unnamed)"}: ${s.detail}.`,
    );
  }
  return result;
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
      capabilities: { declared: 0, skipped: [] },
      errors: [`Not a directory: ${dir}`],
      warnings: [],
    };
  }

  // network.bkn — required, must declare a knowledge_network.
  const networkPath = join(dir, "network.bkn");
  let capabilities: CapabilityCheck = { declared: 0, skipped: [] };
  if (!existsSync(networkPath)) {
    errors.push("Missing network.bkn at the BKN root.");
  } else {
    const networkText = readFileSync(networkPath, "utf8");
    const fm = parseFrontmatter(networkText);
    if (!fm) errors.push("network.bkn has no frontmatter block.");
    else {
      if (fm.type !== "knowledge_network")
        errors.push(`network.bkn type must be 'knowledge_network', got '${fm.type ?? ""}'.`);
      if (!fm.id) errors.push("network.bkn is missing 'id'.");
      if (!fm.name) errors.push("network.bkn is missing 'name'.");
      capabilities = checkCapabilities(networkText, warnings);
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
    capabilities,
    errors,
    warnings,
  };
}
