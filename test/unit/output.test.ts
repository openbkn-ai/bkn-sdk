import { afterEach, describe, expect, it, vi } from "vitest";
import { printJson } from "../../src/utils/output.js";

function capture(fn: () => void): string {
  let out = "";
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((s) => {
    out += String(s);
    return true;
  });
  try {
    fn();
  } finally {
    spy.mockRestore();
  }
  return out;
}
afterEach(() => vi.restoreAllMocks());

describe("printJson output mode", () => {
  const rows = [
    { id: "1", name: "alpha" },
    { id: "2", name: "beta" },
  ];

  it("--json emits JSON, not a table", () => {
    const out = capture(() => printJson(rows, { json: true }));
    expect(out).toContain('"name": "alpha"');
    expect(out).not.toContain("┌");
  });

  it("--compact emits single-line JSON", () => {
    const out = capture(() => printJson(rows, { compact: true }));
    expect(out).toContain('[{"id":"1"');
  });

  it("human mode renders an array of objects as aligned columns (no borders)", () => {
    const out = capture(() => printJson(rows));
    expect(out).not.toContain("┌");
    expect(out).toContain("id");
    expect(out).toContain("alpha");
    // header line then one line per row
    expect(out.trim().split("\n")).toHaveLength(3);
  });

  it("unwraps an `entries` envelope into columns", () => {
    const out = capture(() => printJson({ entries: rows, total: 2 }));
    expect(out).not.toContain("┌");
    expect(out).toContain("beta");
  });

  it("drops columns that are empty across all rows", () => {
    const out = capture(() =>
      printJson([
        { id: "1", note: "" },
        { id: "2", note: "" },
      ]),
    );
    expect(out).not.toContain("note");
    expect(out).toContain("id");
  });

  it("comma-joins scalar array cells (e.g. tags)", () => {
    const out = capture(() => printJson([{ id: "1", tags: ["a", "b"] }]));
    expect(out).toContain("a,b");
    expect(out).not.toContain("[");
  });

  it("falls back to pretty JSON for a single object", () => {
    const out = capture(() => printJson({ id: "x", nested: { a: 1 } }));
    expect(out).not.toContain("┌");
    expect(out).toContain('"id": "x"');
  });

  it("truncates long cells", () => {
    const out = capture(() => printJson([{ v: "x".repeat(100) }]));
    expect(out).toContain("…");
  });

  it("renders an empty (204-style) response as valid JSON", () => {
    const out = capture(() => printJson(undefined, { json: true }));
    expect(out.trim()).toBe("null");
    expect(() => JSON.parse(out)).not.toThrow();
  });

  it("renders an empty response readably in human mode", () => {
    expect(capture(() => printJson(undefined)).trim()).toBe("(ok)");
  });
});
