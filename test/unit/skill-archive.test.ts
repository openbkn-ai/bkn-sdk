import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { unzipToDirectory, zipDirectory } from "../../src/utils/skill-archive.js";

const temps: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "bkn-skill-"));
  temps.push(d);
  return d;
}
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("skill archive zip/unzip", () => {
  it("round-trips a skill directory (incl. nested files)", async () => {
    const src = tmp();
    writeFileSync(join(src, "SKILL.md"), "# demo skill\n");
    mkdirSync(join(src, "scripts"));
    writeFileSync(join(src, "scripts", "run.sh"), "echo hi\n");

    const bytes = await zipDirectory(src);
    expect(bytes.length).toBeGreaterThan(0);

    const dst = tmp();
    const written = await unzipToDirectory(bytes, dst);
    expect(written.length).toBe(2);
    expect(readFileSync(join(dst, "SKILL.md"), "utf8")).toBe("# demo skill\n");
    expect(readFileSync(join(dst, "scripts", "run.sh"), "utf8")).toBe("echo hi\n");
  });
});
