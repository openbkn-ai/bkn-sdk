/**
 * Primary-key / display-key resolution for BKN object types built from tables.
 *
 * Getting the PK wrong silently builds an index over the wrong key and drops
 * most rows (the kweaver-sdk #97 data-loss bug), so resolution is deliberate:
 *   1. caller override (--pk-map)
 *   2. schema-declared single PK (datasource metadata)
 *   3. sample-based cardinality detection
 * A composite schema PK is surfaced as `ambiguous` — BKN takes ONE key, so the
 * caller must disambiguate; we never silently pick one.
 */

export const PK_NAME_HINTS = ["id", "_id", "pk"];
export const DISPLAY_HINTS = ["name", "title", "label", "display_name", "description"];

export interface TableColumn {
  name: string;
  type: string;
  isPrimaryKey?: boolean;
}
export interface TableInfo {
  name: string;
  columns: TableColumn[];
  primaryKeys?: string[];
}

export interface PkCandidate {
  name: string;
  cardinality: number;
}
export interface PkResolution {
  pk: string | null;
  source: "override" | "schema" | "sample" | "ambiguous";
  candidates?: PkCandidate[];
  sampleSize?: number;
  ambiguous?: string[];
}

/** Sample-based PK detection: a column whose values are unique across the sample. */
export function detectPrimaryKey(
  table: TableInfo,
  rows?: Array<Record<string, string | null>>,
): { pk: string | null; candidates: PkCandidate[]; sampleSize: number } {
  if (!rows || rows.length === 0) return { pk: null, candidates: [], sampleSize: 0 };

  const candidates: PkCandidate[] = table.columns
    .map((col) => ({ name: col.name, cardinality: new Set(rows.map((r) => r[col.name])).size }))
    .sort((a, b) => b.cardinality - a.cardinality);

  const full = candidates.filter((c) => c.cardinality === rows.length);
  if (full.length === 0) return { pk: null, candidates, sampleSize: rows.length };

  const named = full.find((c) => {
    const lower = c.name.toLowerCase();
    return PK_NAME_HINTS.some((h) => lower === h || lower.endsWith(`_${h}`));
  });
  return { pk: named?.name ?? (full[0] as PkCandidate).name, candidates, sampleSize: rows.length };
}

function collectSchemaPks(table: TableInfo): string[] {
  // Filter against the real column list — stale catalog metadata must fall
  // through to sample/fail rather than poison object-type creation.
  const colNames = new Set(table.columns.map((c) => c.name));
  if (Array.isArray(table.primaryKeys) && table.primaryKeys.length > 0) {
    return table.primaryKeys.filter((n) => colNames.has(n));
  }
  return table.columns.filter((c) => c.isPrimaryKey === true).map((c) => c.name);
}

/** Resolve a single PK in priority order; composite schema PKs are ambiguous. */
export function resolvePrimaryKey(
  table: TableInfo,
  sampleRows?: Array<Record<string, string | null>>,
  override?: string | null,
): PkResolution {
  if (override) return { pk: override, source: "override" };

  const schemaPks = collectSchemaPks(table);
  if (schemaPks.length === 1) return { pk: schemaPks[0] as string, source: "schema" };
  if (schemaPks.length > 1) return { pk: null, source: "ambiguous", ambiguous: schemaPks };

  const sample = detectPrimaryKey(table, sampleRows);
  return {
    pk: sample.pk,
    source: "sample",
    candidates: sample.candidates,
    sampleSize: sample.sampleSize,
  };
}

/** Pick a display key: first column matching a display hint, else the PK. */
export function detectDisplayKey(table: TableInfo, primaryKey: string): string {
  for (const col of table.columns) {
    if (DISPLAY_HINTS.some((h) => col.name.toLowerCase().includes(h))) return col.name;
  }
  return primaryKey;
}

/** Parse `--pk-map "t1:col1,t2:col2"` into a record. Throws on malformed input. */
export function parsePkMap(input: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    const idx = pair.indexOf(":");
    if (idx <= 0 || idx >= pair.length - 1) {
      throw new Error(`Invalid --pk-map entry '${pair}'. Expected '<table>:<field>[,...]'`);
    }
    out[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
  return out;
}

/** Human-facing message when PK auto-detection fails. */
export function formatPkDetectionError(
  tableName: string,
  result: { candidates: PkCandidate[]; sampleSize: number },
): string {
  const lines = [`Cannot auto-detect a primary key for table '${tableName}'.`];
  if (result.sampleSize === 0) {
    lines.push("  No sample data available — pass --pk-map <table>:<column>.");
  } else {
    lines.push(`  No column is unique across the ${result.sampleSize}-row sample.`);
    lines.push("  Top candidates by cardinality:");
    for (const c of result.candidates.slice(0, 5)) {
      lines.push(`    ${c.name}  ${c.cardinality} unique`);
    }
  }
  lines.push("", `  Specify explicitly:  --pk-map ${tableName}:<column>`);
  return lines.join("\n");
}
