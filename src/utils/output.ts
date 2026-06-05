/** Output helpers: clean JSON for scripts, aligned plain columns for humans. */
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
    // Drop columns that are empty across every row — keeps wide list payloads
    // readable instead of printing a sea of blank columns.
    const columns = columnsOf(rows).filter((c) => rows.some((r) => stringifyCell(r[c]) !== ""));
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

/**
 * Print rows as space-aligned columns (no borders), or as JSON when
 * `--json`/`--compact` is set. Header row + left-aligned columns separated by
 * two spaces — readable without drawing an ASCII grid.
 */
export function printTable(
  rows: Array<Record<string, unknown>>,
  columns: string[],
  opts: OutputOptions = {},
): void {
  if (opts.json || opts.compact) {
    printJson(rows, opts);
    return;
  }
  const cells = rows.map((row) => columns.map((c) => stringifyCell(row[c])));
  const widths = columns.map((col, i) =>
    Math.max(displayWidth(col), ...cells.map((r) => displayWidth(r[i] ?? ""))),
  );
  const fmt = (parts: string[]) =>
    parts
      .map((p, i) => (i === parts.length - 1 ? p : pad(p, widths[i] ?? 0)))
      .join("  ")
      .trimEnd();
  const lines = [fmt(columns), ...cells.map(fmt)];
  process.stdout.write(`${lines.join("\n")}\n`);
}

const CELL_MAX = 48;

/** Visual width counting East-Asian wide chars as 2 columns. */
function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1;
  return w;
}

/** Right-pad to a visual width (wide-char aware). */
function pad(s: string, width: number): string {
  const gap = width - displayWidth(s);
  return gap > 0 ? s + " ".repeat(gap) : s;
}

function stringifyCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  // Arrays of scalars read better comma-joined than as JSON (e.g. tags).
  const raw =
    Array.isArray(v) && v.every((x) => x === null || typeof x !== "object")
      ? v.join(",")
      : typeof v === "object"
        ? JSON.stringify(v)
        : String(v);
  const s = raw.replace(/\s+/g, " ").trim();
  return s.length > CELL_MAX ? `${s.slice(0, CELL_MAX - 1)}…` : s;
}
