// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * CSV → vega-catalog import helpers. A CSV is ingested by running a one-shot
 * dataflow DAG (`@internal/database/write`) per batch: the first batch creates
 * the table, later batches append. All target columns default to VARCHAR(512).
 */
import { readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { parse } from "csv-parse/sync";

export interface CsvData {
  headers: string[];
  rows: Array<Record<string, string | null>>;
}

/** Parse a CSV file into headers + rows (BOM-stripped, "" → null). */
export async function parseCsvFile(filePath: string): Promise<CsvData> {
  let content = await readFile(filePath, "utf8");
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);

  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: false,
  }) as Array<Record<string, string>>;

  if (records.length === 0) {
    const headerRows = parse(content, {
      columns: false,
      skip_empty_lines: false,
      trim: true,
      to: 1,
    }) as string[][];
    return { headers: headerRows[0] ?? [], rows: [] };
  }

  const headers = Object.keys(records[0] as Record<string, string>);
  const rows = records.map((rec) => {
    const row: Record<string, string | null> = {};
    for (const k of headers) row[k] = rec[k] === "" ? null : (rec[k] ?? null);
    return row;
  });
  return { headers, rows };
}

/** Derive a BKN-safe table name from a CSV path + optional prefix. */
export function buildTableName(filePath: string, prefix = ""): string {
  const stem = basename(filePath).replace(/\.csv$/i, "");
  return `${prefix}${stem}`.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^(\d)/, "_$1");
}

export function splitBatches<T>(rows: T[], batchSize: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += batchSize) out.push(rows.slice(i, i + batchSize));
  return out;
}

export interface FieldMapping {
  source: { name: string };
  target: { name: string; data_type: string };
}

export function buildFieldMappings(headers: string[]): FieldMapping[] {
  return headers.map((name) => ({ source: { name }, target: { name, data_type: "VARCHAR(512)" } }));
}

export interface DagBodyOptions {
  catalogId: string;
  datasourceType: string;
  tableName: string;
  tableExist: boolean;
  data: Array<Record<string, string | null>>;
  fieldMappings: FieldMapping[];
}

/** A 2-step dataflow doc: manual trigger → database write. */
export function buildImportDag(opts: DagBodyOptions): Record<string, unknown> {
  return {
    title: `import-csv-${opts.tableName}`,
    description: `CSV import into table ${opts.tableName}`,
    trigger_config: { operator: "@internal/trigger/manual" },
    steps: [
      { id: "step-trigger", title: "Trigger", operator: "@trigger/manual", parameters: {} },
      {
        id: "step-write",
        title: "Write to Database",
        operator: "@internal/database/write",
        parameters: {
          datasource_type: opts.datasourceType,
          datasource_id: opts.catalogId,
          table_name: opts.tableName,
          table_exist: opts.tableExist,
          operate_type: "append",
          data: opts.data,
          sync_model_fields: opts.fieldMappings,
        },
      },
    ],
  };
}

/** Single-level glob (`dir/*.csv`) — readdir + basename match. Node 18 safe. */
function globOne(pattern: string): string[] {
  const dir = dirname(pattern);
  const re = new RegExp(
    `^${basename(pattern)
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".")}$`,
  );
  let entries: string[];
  try {
    entries = readdirSync(resolve(dir));
  } catch {
    return [];
  }
  return entries.filter((f) => re.test(f)).map((f) => resolve(dir, f));
}

/** Resolve a comma/glob file pattern into absolute .csv paths. */
export async function resolveFiles(pattern: string): Promise<string[]> {
  const out: string[] = [];
  for (const part of pattern
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)) {
    if (part.includes("*") || part.includes("?")) {
      for (const p of globOne(part)) {
        if (/\.csv$/i.test(p)) out.push(p);
      }
    } else {
      statSync(resolve(part)); // throws if missing
      out.push(resolve(part));
    }
  }
  if (out.length === 0) throw new Error(`No CSV files matched: ${pattern}`);
  return out;
}
