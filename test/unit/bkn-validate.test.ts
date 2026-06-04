import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateBknDirectory } from "../../src/utils/bkn-validate.js";

const temps: string[] = [];
function bkn(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "bkn-val-"));
  temps.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

const ot = (id: string, name: string) => `---\ntype: object_type\nid: ${id}\nname: ${name}\n---\n`;

describe("bkn validate", () => {
  it("accepts a well-formed network", () => {
    const dir = bkn({
      "network.bkn": "---\ntype: knowledge_network\nid: kn1\nname: KN One\n---\n",
      "object_types/a.bkn": ot("a", "Alpha"),
      "object_types/b.bkn": ot("b", "Beta"),
      "relation_types/r.bkn":
        "---\ntype: relation_type\nid: r\nname: R\n---\n\n### Endpoint\n\n| Source | Target | Type |\n|--|--|--|\n| a | b | direct |\n",
    });
    const r = validateBknDirectory(dir);
    expect(r.valid).toBe(true);
    expect(r.counts).toEqual({ objectTypes: 2, relationTypes: 1, conceptGroups: 0 });
    expect(r.warnings).toEqual([]);
  });

  it("flags missing network.bkn", () => {
    const r = validateBknDirectory(bkn({ "object_types/a.bkn": ot("a", "A") }));
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toContain("Missing network.bkn");
  });

  it("flags an over-long object-type name and duplicate ids", () => {
    const long = "x".repeat(41);
    const dir = bkn({
      "network.bkn": "---\ntype: knowledge_network\nid: k\nname: K\n---\n",
      "object_types/a.bkn": ot("dup", long),
      "object_types/b.bkn": ot("dup", "Beta"),
    });
    const r = validateBknDirectory(dir);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("exceeds"))).toBe(true);
    expect(r.errors.some((e) => e.includes("Duplicate object_type id"))).toBe(true);
  });

  it("warns on an endpoint referencing an unknown object type", () => {
    const dir = bkn({
      "network.bkn": "---\ntype: knowledge_network\nid: k\nname: K\n---\n",
      "object_types/a.bkn": ot("a", "A"),
      "relation_types/r.bkn":
        "---\ntype: relation_type\nid: r\nname: R\n---\n\n### Endpoint\n\n| Source | Target | Type |\n|--|--|--|\n| a | ghost | direct |\n",
    });
    const r = validateBknDirectory(dir);
    expect(r.valid).toBe(true); // unknown endpoint is a warning, not an error
    expect(r.warnings.some((w) => w.includes("ghost"))).toBe(true);
  });
});
