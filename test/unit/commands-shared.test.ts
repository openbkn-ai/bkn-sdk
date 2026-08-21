import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readBody } from "../../src/commands/_shared.js";

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
