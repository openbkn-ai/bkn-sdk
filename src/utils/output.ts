/** Output helpers: clean JSON for scripts, aligned plain columns for humans. */
export interface OutputOptions {
  /** Emit machine-readable JSON instead of a table. */
  json?: boolean;
  /** Single-line JSON (implies json). */
  compact?: boolean;
  /** Human view: show every column instead of the trimmed key set. */
  full?: boolean;
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
    // `--full` shows every non-empty column; default trims further. Hide the
    // footer count is measured against `--full` so all-empty columns (which
    // `--full` also drops) never inflate "N more".
    const fullColumns = columnsOf(rows).filter((c) => rows.some((r) => stringifyCell(r[c]) !== ""));
    const columns = opts.full ? fullColumns : selectColumns(rows);
    if (columns.length > 0) {
      printTable(rows, columns);
      const hidden = fullColumns.length - columns.length;
      if (hidden > 0 && !opts.full) {
        process.stdout.write(`… ${hidden} more column(s); use --full or --json for everything\n`);
      }
      return;
    }
  }
  // A recognized list envelope that's simply empty → say so, not raw JSON.
  if (isEmptyEnvelope(value)) {
    process.stdout.write("(no results)\n");
    return;
  }
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/** True when value is `{ <envelope>: [] }` (an empty list response). */
function isEmptyEnvelope(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return ROW_ENVELOPES.some((k) => Array.isArray(o[k]) && (o[k] as unknown[]).length === 0);
}

const ROW_ENVELOPES = [
  "entries",
  "data",
  "cases",
  "reports",
  "results",
  "list",
  "recurringRules",
  "users",
  "roles",
  "departments",
  "members",
];

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

/** Max columns shown in the human view before truncating (use --full / --json). */
const MAX_COLS = 8;

/** Audit/bookkeeping columns hidden by default — rarely the point of a list. */
const NOISE_COLS = new Set([
  "creator",
  "updater",
  "create_by",
  "update_by",
  "create_user",
  "update_user",
  "operations",
  "status_message",
  "last_check_time",
  "last_discover_status",
  "health_check_result",
  "health_check_enabled",
]);
const isNoiseCol = (c: string) => NOISE_COLS.has(c) || /_time$/.test(c);

/** Identity / key attributes a human scans for first. */
const isKeyCol = (c: string) =>
  /^(id|name|key|title|label)$/i.test(c) ||
  /_(id|name|key)$/i.test(c) ||
  /^(status|state|type|category|mode|enabled|version|branch)$/i.test(c);

/**
 * Pick the columns worth showing a human: drop empty / nested-object / audit
 * columns, then order by usefulness (identity & key attributes first, long free
 * text last) and cap the count. The full record is always one `--full`/`--json`
 * away.
 */
function selectColumns(rows: Array<Record<string, unknown>>): string[] {
  const isObj = (v: unknown) => v !== null && typeof v === "object" && !Array.isArray(v);
  const kept = columnsOf(rows).filter((c) => {
    if (isNoiseCol(c)) return false;
    const vals = rows.map((r) => r[c]);
    if (!vals.some((v) => stringifyCell(v) !== "")) return false; // all empty
    if (vals.every((v) => v === null || v === undefined || isObj(v))) return false; // nested objects
    return true;
  });
  // Long free-text (always truncated) is informative but bulky → push to the end.
  const isLongText = (c: string) =>
    rows.every((r) => {
      const s = stringifyCell(r[c]);
      return s === "" || s.length >= CELL_MAX - 1;
    });
  const rank = (c: string) => (isKeyCol(c) ? 0 : isLongText(c) ? 2 : 1);
  const ordered = kept
    .map((c, i) => ({ c, i, r: rank(c) }))
    .sort((a, b) => a.r - b.r || a.i - b.i) // stable: rank, then original order
    .map((x) => x.c);
  return ordered.slice(0, MAX_COLS);
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
