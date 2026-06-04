/** Output helpers: clean JSON for scripts, aligned tables for humans. */
import Table from "cli-table3";

export interface OutputOptions {
  /** Emit machine-readable JSON instead of a table. */
  json?: boolean;
  /** Single-line JSON (implies json). */
  compact?: boolean;
}

/**
 * Primary output sink. With `--json`/`--compact` (the equivalence path) it
 * prints JSON. Otherwise it renders a human table when the payload is a list of
 * objects (unwrapping common envelopes like `entries`/`data`/`cases`), falling
 * back to pretty JSON for single objects / scalars.
 */
export function printJson(value: unknown, opts: OutputOptions = {}): void {
  if (opts.json || opts.compact) {
    process.stdout.write(`${JSON.stringify(value, null, opts.compact ? 0 : 2)}\n`);
    return;
  }
  const rows = toRows(value);
  if (rows) {
    const columns = columnsOf(rows);
    if (columns.length > 0) {
      printTable(rows, columns);
      return;
    }
  }
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

const ROW_ENVELOPES = ["entries", "data", "cases", "reports", "results", "list", "recurringRules"];

/** Find the primary array-of-objects in a value (unwrapping common envelopes). */
function toRows(value: unknown): Array<Record<string, unknown>> | null {
  const isRowArray = (v: unknown): v is Array<Record<string, unknown>> =>
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((x) => x !== null && typeof x === "object" && !Array.isArray(x));
  if (isRowArray(value)) return value;
  if (value && typeof value === "object") {
    for (const key of ROW_ENVELOPES) {
      const inner = (value as Record<string, unknown>)[key];
      if (isRowArray(inner)) return inner;
    }
  }
  return null;
}

/** Column set = union of row keys, in first-seen order. */
function columnsOf(rows: Array<Record<string, unknown>>): string[] {
  const seen: string[] = [];
  for (const row of rows) {
    for (const k of Object.keys(row)) if (!seen.includes(k)) seen.push(k);
  }
  return seen;
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

const CELL_MAX = 48;

function stringifyCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = (typeof v === "object" ? JSON.stringify(v) : String(v)).replace(/\s+/g, " ").trim();
  return s.length > CELL_MAX ? `${s.slice(0, CELL_MAX - 1)}…` : s;
}
