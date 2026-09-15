import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readBody, readJsonArgs } from "../../src/commands/_shared.js";

const BIGINT = 110101199001152345n;
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("readBody", () => {
  it("preserves unsafe integers from --body", () => {
    expect(readBody({ body: '{"condition":{"value":110101199001152345}}' })).toEqual({
      condition: { value: BIGINT },
    });
  });

  it("preserves unsafe integers from --body-file", () => {
    const dir = mkdtempSync(join(tmpdir(), "bkn-body-"));
    tempDirs.push(dir);
    const path = join(dir, "body.json");
    writeFileSync(path, '{"condition":{"value":110101199001152345}}');

    expect(readBody({ bodyFile: path })).toEqual({ condition: { value: BIGINT } });
  });
});

describe("readJsonArgs", () => {
  it("reads a JSON object from --args-file and preserves unsafe integers", () => {
    const dir = mkdtempSync(join(tmpdir(), "bkn-args-"));
    tempDirs.push(dir);
    const path = join(dir, "args.json");
    writeFileSync(path, '{"instance_id":110101199001152345}');

    expect(readJsonArgs({ argsFile: path })).toEqual({ instance_id: BIGINT });
  });

  it("rejects competing inline and file argument sources", () => {
    expect(() => readJsonArgs({ args: "{}", argsFile: "args.json" })).toThrow(
      "--args and --args-file cannot be combined",
    );
  });

  it.each(["null", "[]", "42", '"text"'])("rejects a non-object JSON argument: %s", (args) => {
    expect(() => readJsonArgs({ args })).toThrow("--args must be a JSON object");
  });
});
