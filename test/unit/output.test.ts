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

  it("human mode renders an array of objects as a table", () => {
    const out = capture(() => printJson(rows));
    expect(out).toContain("┌");
    expect(out).toContain("id");
    expect(out).toContain("alpha");
  });

  it("unwraps an `entries` envelope into a table", () => {
    const out = capture(() => printJson({ entries: rows, total: 2 }));
    expect(out).toContain("┌");
    expect(out).toContain("beta");
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
});
