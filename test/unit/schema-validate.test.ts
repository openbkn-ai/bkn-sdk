import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateSchemaFile } from "../../src/trace-ai/schema-validate.js";

const temps: string[] = [];
function file(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "bkn-schema-"));
  temps.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content);
  return p;
}
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("trace schema validate", () => {
  it("accepts a valid eval-set JSON", () => {
    const f = file(
      "e.json",
      '{"cases":[{"query":"hi","assertions":[{"type":"contains","value":"x"}]}]}',
    );
    expect(validateSchemaFile(f)).toMatchObject({ valid: true, kind: "eval-set" });
  });
  it("rejects a bad assertion type", () => {
    const f = file("e.json", '{"cases":[{"query":"hi","assertions":[{"type":"bogus"}]}]}');
    expect(validateSchemaFile(f).valid).toBe(false);
  });
  it("accepts a valid YAML rule and auto-detects kind", () => {
    const f = file("r.yaml", "id: r1\nseverity: high\nsymptom: loop\npredicate: builtin:x\n");
    const r = validateSchemaFile(f);
    expect(r.valid).toBe(true);
    expect(r.kind).toBe("rule");
  });
  it("reports a parse error for malformed JSON", () => {
    const f = file("e.json", "{not json");
    const r = validateSchemaFile(f);
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain("parse error");
  });
});
