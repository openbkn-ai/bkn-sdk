#!/usr/bin/env node
// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const releaseVersion = readFileSync(join(root, "VERSION"), "utf8").trim();
const packageVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;

if (!/^\d+\.\d+\.\d+$/.test(releaseVersion)) {
  throw new Error(
    `VERSION must be a stable X.Y.Z version; received ${JSON.stringify(releaseVersion)}.`,
  );
}

const prereleasePattern = new RegExp(
  `^${releaseVersion.replaceAll(".", "\\.")}-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*$`,
);

if (packageVersion !== releaseVersion && !prereleasePattern.test(packageVersion)) {
  throw new Error(
    `package.json version ${JSON.stringify(packageVersion)} must equal VERSION ${JSON.stringify(releaseVersion)} or use it as a prerelease prefix (for example, 0.1.5-rc.1).`,
  );
}

// The Python OSDK under `python/` ships from the same tag, so its version is the
// same release in PEP 440 spelling: 0.2.1-rc.2 -> 0.2.1rc2, -alpha.1 -> a1,
// -beta.1 -> b1, -dev.1 -> .dev1.
const PEP440_LABEL = { a: "a", alpha: "a", b: "b", beta: "b", rc: "rc", dev: ".dev" };

function pep440(version) {
  const match = /^(\d+\.\d+\.\d+)(?:-([A-Za-z]+)\.?(\d+)?)?$/.exec(version);
  if (!match) return undefined;
  const [, release, label, number] = match;
  if (!label) return release;
  const mapped = PEP440_LABEL[label.toLowerCase()];
  return mapped === undefined ? undefined : `${release}${mapped}${number ?? "0"}`;
}

const pyproject = readFileSync(join(root, "python", "pyproject.toml"), "utf8");
const pythonVersion = /^version\s*=\s*"([^"]+)"/m.exec(pyproject)?.[1];
const expectedPython = pep440(packageVersion);

if (expectedPython === undefined) {
  throw new Error(
    `package.json version ${JSON.stringify(packageVersion)} has no PEP 440 form for python/pyproject.toml; use an rc, alpha, beta or dev prerelease (for example, 0.1.5-rc.1).`,
  );
}
if (pythonVersion !== expectedPython) {
  throw new Error(
    `python/pyproject.toml version ${JSON.stringify(pythonVersion)} must equal ${JSON.stringify(expectedPython)}, the PEP 440 form of package.json ${JSON.stringify(packageVersion)}.`,
  );
}

console.log(
  `version consistency passed: VERSION=${releaseVersion}, package.json=${packageVersion}, python=${pythonVersion}`,
);
