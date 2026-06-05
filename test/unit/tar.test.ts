import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { extractTarToDirectory, packDirectoryToTar } from "../../src/utils/tar.js";

const temps: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "bkn-tar-"));
  temps.push(d);
  return d;
}
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("bkn tar pack/extract", () => {
  it("round-trips a directory's contents", () => {
    const src = tmp();
    writeFileSync(join(src, "schema.json"), '{"objectTypes":[]}');
    mkdirSync(join(src, "data"));
    writeFileSync(join(src, "data", "rows.csv"), "a,b\n1,2\n");

    const tar = packDirectoryToTar(src);
    expect(tar.length).toBeGreaterThan(0);

    const dst = tmp();
    extractTarToDirectory(tar, dst);
    expect(readFileSync(join(dst, "schema.json"), "utf8")).toBe('{"objectTypes":[]}');
    expect(readFileSync(join(dst, "data", "rows.csv"), "utf8")).toBe("a,b\n1,2\n");
  });
});
