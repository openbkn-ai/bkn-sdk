import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { kn } from "../../src/resources/knowledge-networks.js";
import type { RequestContext } from "../../src/types.js";
import { validateBknDirectory } from "../../src/utils/bkn-validate.js";
import { InputError } from "../../src/utils/errors.js";

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
  vi.unstubAllGlobals();
});

const ot = (id: string, name: string) => `---\ntype: object_type\nid: ${id}\nname: ${name}\n---\n`;
const network = "---\ntype: knowledge_network\nid: kn1\nname: KN One\n---\n";
const otWithMaskRules = (rows: Array<[string, string, string]>) => `${ot("a", "Alpha")}
## ObjectType: Alpha

### Data Properties

| Name | Display Name | Type | Description | Mapped Field | Mask Rule |
|------|--------------|------|-------------|--------------|-----------|
${rows.map(([name, type, rule]) => `| ${name} | ${name} | ${type} | | ${name} | ${rule} |`).join("\n")}
`;

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

  it("accepts every supported mask-rule kind and Unicode boundaries", () => {
    const dir = bkn({
      "network.bkn": network,
      "object_types/a.bkn": otWithMaskRules([
        ["secret", "string", `{"kind":"fixed","replacement":"保密🔒"}`],
        [
          "account",
          "keyword",
          `{"kind":"partial","keep_start":0,"keep_end":64,"replacement":"\\u007c"}`,
        ],
        [
          "email",
          "text",
          `{"kind":"email","local_keep_start":64,"preserve_domain":false,"replacement":"●"}`,
        ],
        ["amount", "decimal", `{"kind":"round","step":0.000001}`],
        ["created_at", "timestamp", `{"kind":"date_granularity","granularity":"day"}`],
      ]),
    });

    expect(validateBknDirectory(dir).errors).toEqual([]);
  });

  it.each([
    ["malformed JSON", "string", "{"],
    ["unknown kind", "string", `{"kind":"regex","replacement":"*"}`],
    ["unknown field", "string", `{"kind":"fixed","replacement":"*","keep_strat":1}`],
    ["type mismatch", "boolean", `{"kind":"fixed","replacement":"*"}`],
    ["keep bound", "string", `{"kind":"partial","keep_start":65,"keep_end":0,"replacement":"*"}`],
    ["non-printable replacement", "string", JSON.stringify({ kind: "fixed", replacement: "\n" })],
    ["round step", "integer", `{"kind":"round","step":0}`],
    ["date precision", "date", `{"kind":"date_granularity","granularity":"day"}`],
    ["unsupported property type", "vector", `{"kind":"fixed","replacement":"*"}`],
  ])("rejects an invalid mask rule: %s", (_name, type, rule) => {
    const dir = bkn({
      "network.bkn": network,
      "object_types/a.bkn": otWithMaskRules([["secret", type, rule]]),
    });

    const result = validateBknDirectory(dir);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes("data property 'secret'"))).toBe(true);
  });

  it("rejects an invalid mask rule before push performs network I/O", async () => {
    const dir = bkn({
      "network.bkn": network,
      "object_types/a.bkn": otWithMaskRules([
        ["secret", "json", `{"kind":"fixed","replacement":"*"}`],
      ]),
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const ctx: RequestContext = {
      baseUrl: "https://demo.example.com",
      token: "token",
      insecure: false,
    };

    await expect(kn(ctx).push(dir)).rejects.toBeInstanceOf(InputError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
