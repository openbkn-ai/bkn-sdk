// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// The test's own spelling of the mapping, so a checker regression cannot hide
// behind a helper that shares its bug.
function pep440(version: string): string {
  return version.replace(/-rc\.?(\d+)$/, "rc$1");
}

describe("the package version contract", () => {
  const roots: string[] = [];
  const checker = new URL("../../scripts/check-version.mjs", import.meta.url).pathname;

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { force: true, recursive: true });
    }
  });

  const check = (
    packageVersion: string,
    versionFile = "0.1.5\n",
    pythonVersion = pep440(packageVersion),
  ) => {
    const root = mkdtempSync(join(tmpdir(), "bkn-sdk-version-"));
    roots.push(root);
    mkdirSync(join(root, "scripts"));
    cpSync(checker, join(root, "scripts/check-version.mjs"));
    writeFileSync(join(root, "VERSION"), versionFile);
    writeFileSync(join(root, "package.json"), JSON.stringify({ version: packageVersion }));
    mkdirSync(join(root, "python"));
    writeFileSync(
      join(root, "python", "pyproject.toml"),
      `[project]\nname = "bkn-osdk"\nversion = "${pythonVersion}"\n`,
    );
    return spawnSync(process.execPath, [join(root, "scripts/check-version.mjs")], {
      encoding: "utf8",
    });
  };

  it.each(["0.1.5", "0.1.5-rc1", "0.1.5-rc.1"])("accepts %s", (version) => {
    expect(check(version).status).toBe(0);
  });

  it.each(["0.1.5-", "0.1.5-_x", "0.1.6-rc.1"])("rejects %s", (version) => {
    const result = check(version);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("must equal VERSION");
  });

  it.each(["0.1", "0.1.5-rc.1", "v0.1.5"])("rejects invalid VERSION %s", (version) => {
    const result = check("0.1.5", `${version}\n`);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("VERSION must be a stable X.Y.Z version");
  });

  it.each([
    ["0.2.1", "0.2.1"],
    ["0.2.1-rc.2", "0.2.1rc2"],
    ["0.2.1-alpha.3", "0.2.1a3"],
    ["0.2.1-beta.1", "0.2.1b1"],
    ["0.2.1-dev.4", "0.2.1.dev4"],
  ])("accepts python version for %s as %s", (version, python) => {
    expect(check(version, "0.2.1\n", python).status).toBe(0);
  });

  it.each([
    ["0.2.1-rc.2", "0.2.1"],
    ["0.2.1-rc.2", "0.2.1-rc.2"],
    ["0.2.1", "0.1.0"],
  ])("rejects python version for %s spelled %s", (version, python) => {
    const result = check(version, "0.2.1\n", python);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("python/pyproject.toml version");
  });

  it("rejects a prerelease label with no PEP 440 form", () => {
    const result = check("0.2.1-x", "0.2.1\n", "0.2.1");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("has no PEP 440 form");
  });

  it("checks the checked-in VERSION against package.json", () => {
    const root = new URL("../../", import.meta.url);
    const version = readFileSync(new URL("VERSION", root), "utf8").trim();
    const packageVersion = JSON.parse(readFileSync(new URL("package.json", root), "utf8")).version;
    const python = /^version\s*=\s*"([^"]+)"/m.exec(
      readFileSync(new URL("python/pyproject.toml", root), "utf8"),
    )?.[1];
    expect(check(packageVersion, `${version}\n`, python).status).toBe(0);
  });
});
