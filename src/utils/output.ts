/** Output helpers: clean JSON for scripts, aligned tables for humans. */
import Table from "cli-table3";

export interface OutputOptions {
  /** Emit machine-readable JSON instead of a table. */
  json?: boolean;
  /** Single-line JSON (implies json). */
  compact?: boolean;
}

/** Print a value as JSON to stdout. */
export function printJson(value: unknown, opts: OutputOptions = {}): void {
  process.stdout.write(`${JSON.stringify(value, null, opts.compact ? 0 : 2)}\n`);
}

/** Print rows as an aligned table, or as JSON when `--json`/`--compact` is set. */
export function printTable(
  rows: Array<Record<string, unknown>>,
  columns: string[],
  opts: OutputOptions = {},
): void {
  if (opts.json || opts.compact) {
    printJson(rows, opts);
    return;
  }
  const table = new Table({ head: columns });
  for (const row of rows) {
    table.push(columns.map((c) => stringifyCell(row[c])));
  }
  process.stdout.write(`${table.toString()}\n`);
}

function stringifyCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
