/**
 * Extract index-build intent from a local BKN directory's object types.
 *
 * The BKN spec lets an object type declare per-property index config — most
 * relevantly a `vector` (semantic/embedding) index — either in a `### 属性覆盖`
 * / `### Property Overrides` table (`属性名 | 索引配置`, e.g. `fulltext + vector`)
 * or via an `索引` / `Index` column on the Data Properties table. The platform
 * stores that as query-capability metadata but never turns it into a Vega
 * BuildTask: the actual OpenSearch index is built per resource via
 * `POST /build-tasks`. This module bridges the gap — it reads those declarations
 * and the object type's resource binding so the SDK can submit one BuildTask per
 * resource (gated behind an explicit flag). It does NOT depend on the backend
 * markdown parser; the resource id comes straight from the `### Data Source`
 * table, so the build is independent of whether the backend honors index_config.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export interface IndexTarget {
  /** Object-type id (frontmatter) or file stem. */
  objectType: string;
  /** Vega resource the object type binds to (its index target). */
  resourceId: string;
  /** Resource columns to vectorize (mapped fields of vector-marked properties). */
  embeddingFields: string[];
  /** Incremental key (preferred) or primary key — the batch build key. */
  buildKey?: string;
  /** Embedding model id if the declaration pins one (`vector(<model>)`). */
  embeddingModel?: string;
}

/** Split a markdown table row into trimmed cells, preserving empty inner cells. */
function rowCells(line: string): string[] | null {
  const t = line.trim();
  if (!t.startsWith("|")) return null;
  // Drop the leading/trailing pipe's empty cells, keep inner ones (even if blank).
  return t
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function isDivider(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c) || c === "");
}

/** Body of a `### <heading>` section up to the next heading (any level). */
function section(text: string, headingRe: RegExp): string | null {
  const lines = text.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (headingRe.test(lines[i] ?? "")) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return null;
  const out: string[] = [];
  for (let i = start; i < lines.length; i += 1) {
    if (/^#{1,6}\s/.test(lines[i] ?? "")) break;
    out.push(lines[i] ?? "");
  }
  return out.join("\n");
}

/** Find the index of a column whose header matches any alias (case-insensitive). */
function colIndex(header: string[], aliases: RegExp): number {
  return header.findIndex((h) => aliases.test(h));
}

/** Parse the `### Data Source` table → first resource-typed binding's id. */
function resourceBinding(text: string): string | undefined {
  const sec = section(text, /^#{2,3}\s*(data\s*source|数据来源)/i);
  if (!sec) return undefined;
  let header: string[] | null = null;
  for (const line of sec.split("\n")) {
    const cells = rowCells(line);
    if (!cells || isDivider(cells)) continue;
    if (!header) {
      header = cells; // first non-divider row is the header
      continue;
    }
    const typeIdx = Math.max(0, colIndex(header, /type|类型/i));
    const idIdx = colIndex(header, /\bid\b/i);
    const type = (cells[typeIdx] ?? "").toLowerCase();
    const id = (cells[idIdx >= 0 ? idIdx : 1] ?? "").trim();
    if (type === "resource" && id) return id;
  }
  return undefined;
}

/** name → mapped resource field, from the Data Properties table. */
function mappedFields(text: string): Map<string, string> {
  const map = new Map<string, string>();
  const sec = section(text, /^#{2,3}\s*(data\s*propert|数据属性)/i);
  if (!sec) return map;
  let header: string[] | null = null;
  for (const line of sec.split("\n")) {
    const cells = rowCells(line);
    if (!cells || isDivider(cells)) continue;
    if (!header) {
      header = cells;
      continue;
    }
    const nameIdx = Math.max(0, colIndex(header, /^\s*(name|属性名|属性)\s*$/i));
    const mapIdx = colIndex(header, /mapped\s*field|映射字段|映射/i);
    const name = cells[nameIdx] ?? "";
    if (!name) continue;
    map.set(name, (mapIdx >= 0 ? cells[mapIdx] : undefined) || name);
  }
  return map;
}

/**
 * Property names marked for a vector index, plus an optional pinned model.
 * Sources: the `### 属性覆盖` / `### Property Overrides` `索引配置`/`Index Config`
 * column, and any `索引`/`Index` column on the Data Properties table — counted
 * only when the cell explicitly says `vector` (a bare `YES` is index-type
 * agnostic and deliberately ignored).
 */
function vectorProps(text: string): { names: string[]; model?: string } {
  const names = new Set<string>();
  let model: string | undefined;

  const scan = (sec: string | null) => {
    if (!sec) return;
    let header: string[] | null = null;
    for (const line of sec.split("\n")) {
      const cells = rowCells(line);
      if (!cells || isDivider(cells)) continue;
      if (!header) {
        header = cells;
        continue;
      }
      const nameIdx = Math.max(0, colIndex(header, /^\s*(name|属性名|属性)\s*$/i));
      const idxCol = colIndex(header, /索引配置|索引|index\s*config|index/i);
      const cfg = idxCol >= 0 ? (cells[idxCol] ?? "") : "";
      if (/vector/i.test(cfg)) {
        const name = cells[nameIdx] ?? "";
        if (name) names.add(name);
        const m = cfg.match(/vector\s*\(\s*([^)]+?)\s*\)/i);
        if (m?.[1]) model = m[1];
      }
    }
  };

  scan(section(text, /^#{2,3}\s*(property\s*overrides|属性覆盖)/i));
  scan(section(text, /^#{2,3}\s*(data\s*propert|数据属性)/i));
  return { names: [...names], ...(model ? { model } : {}) };
}

/** Batch build key: Incremental Key if set, else the first Primary Key. */
function buildKey(text: string): string | undefined {
  const clean = (v: string) => v.replace(/`/g, "").split(/[,，]/)[0]?.trim() || undefined;
  const incr = text.match(/Incremental\s*Key\s*[:：]\s*(.+)/i);
  if (incr?.[1]?.trim()) return clean(incr[1]);
  const pk =
    text.match(/Primary\s*Keys?\s*[:：]\s*(.+)/i) ||
    text.match(/\*\*\s*主键\s*\*\*\s*[:：]\s*([^|\n]+)/);
  if (pk?.[1]?.trim()) return clean(pk[1]);
  return undefined;
}

/** Object-type id from frontmatter (`id: x`), else undefined. */
function frontmatterId(text: string): string | undefined {
  if (!text.startsWith("---")) return undefined;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return undefined;
  const m = text.slice(3, end).match(/^\s*id\s*:\s*(.+?)\s*$/m);
  return m?.[1]?.replace(/^["']|["']$/g, "");
}

/** Parse one object-type `.bkn` file's index-build intent. */
export function parseObjectTypeIndex(text: string, fallbackName = ""): IndexTarget | null {
  const resourceId = resourceBinding(text);
  if (!resourceId || resourceId.includes("{{")) return null; // unbound or unrendered placeholder
  const { names, model } = vectorProps(text);
  if (names.length === 0) return null;
  const mapped = mappedFields(text);
  const embeddingFields = names.map((n) => mapped.get(n) ?? n);
  return {
    objectType: frontmatterId(text) ?? fallbackName,
    resourceId,
    embeddingFields,
    ...(buildKey(text) ? { buildKey: buildKey(text) } : {}),
    ...(model ? { embeddingModel: model } : {}),
  };
}

/** Collect index-build targets from every object type in a BKN directory. */
export function collectIndexTargets(dir: string): IndexTarget[] {
  const otDir = join(dir, "object_types");
  if (!existsSync(otDir) || !statSync(otDir).isDirectory()) return [];
  const targets: IndexTarget[] = [];
  for (const f of readdirSync(otDir).filter((x) => x.endsWith(".bkn"))) {
    const stem = f.replace(/\.bkn$/, "");
    const target = parseObjectTypeIndex(readFileSync(join(otDir, f), "utf8"), stem);
    if (target) targets.push(target);
  }
  return targets;
}
