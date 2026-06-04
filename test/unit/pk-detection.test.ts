import { describe, expect, it } from "vitest";
import {
  detectDisplayKey,
  detectPrimaryKey,
  parsePkMap,
  resolvePrimaryKey,
} from "../../src/utils/pk-detection.js";

const cols = (names: string[]) => names.map((name) => ({ name, type: "varchar" }));

describe("PK detection (guards #97 silent data loss)", () => {
  it("override wins over everything", () => {
    const r = resolvePrimaryKey(
      { name: "t", columns: cols(["a", "b"]), primaryKeys: ["a"] },
      undefined,
      "b",
    );
    expect(r).toMatchObject({ pk: "b", source: "override" });
  });

  it("single schema PK is used", () => {
    const r = resolvePrimaryKey({ name: "t", columns: cols(["id", "x"]), primaryKeys: ["id"] });
    expect(r).toMatchObject({ pk: "id", source: "schema" });
  });

  it("composite schema PK is ambiguous, never silently picked", () => {
    const r = resolvePrimaryKey({ name: "t", columns: cols(["a", "b"]), primaryKeys: ["a", "b"] });
    expect(r.pk).toBeNull();
    expect(r.source).toBe("ambiguous");
    expect(r.ambiguous).toEqual(["a", "b"]);
  });

  it("stale schema PK (not a real column) falls through to sample", () => {
    const r = resolvePrimaryKey({ name: "t", columns: cols(["a", "b"]), primaryKeys: ["ghost"] }, [
      { a: "1", b: "x" },
      { a: "2", b: "x" },
    ]);
    expect(r).toMatchObject({ pk: "a", source: "sample" });
  });

  it("sample detection prefers an id-named unique column", () => {
    const rows = [
      { user_id: "1", code: "10", name: "a" },
      { user_id: "2", code: "20", name: "b" },
    ];
    expect(
      detectPrimaryKey({ name: "t", columns: cols(["user_id", "code", "name"]) }, rows).pk,
    ).toBe("user_id");
  });

  it("no unique column → null pk (caller must --pk-map)", () => {
    const rows = [
      { a: "x", b: "1" },
      { a: "x", b: "1" },
    ];
    const r = resolvePrimaryKey({ name: "t", columns: cols(["a", "b"]) }, rows);
    expect(r.pk).toBeNull();
    expect(r.source).toBe("sample");
  });

  it("display key prefers a name-like column, else the pk", () => {
    expect(detectDisplayKey({ name: "t", columns: cols(["id", "title"]) }, "id")).toBe("title");
    expect(detectDisplayKey({ name: "t", columns: cols(["id", "qty"]) }, "id")).toBe("id");
  });

  it("parsePkMap parses and rejects malformed input", () => {
    expect(parsePkMap("t1:a,t2:b")).toEqual({ t1: "a", t2: "b" });
    expect(() => parsePkMap("bad")).toThrow();
    expect(() => parsePkMap("t1:")).toThrow();
  });
});
