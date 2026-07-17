#!/usr/bin/env node
// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * Fails the build if the package depends on itself.
 *
 * `npm install @openbkn/bkn-sdk` run inside this repo silently adds the package
 * to its own `dependencies` pinned at whatever version was current — that is how
 * `^0.1.1-alpha.3` landed in 787b806 and shipped in every release from
 * alpha.4 through alpha.18, making consumers download a stale second copy.
 * npm itself does not reject this, so the check lives here.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => JSON.parse(readFileSync(join(root, f), "utf8"));

const pkg = read("package.json");
const self = pkg.name;
const problems = [];

const MANIFEST_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
  "overrides",
  "resolutions",
];

for (const field of MANIFEST_FIELDS) {
  if (pkg[field]?.[self]) {
    problems.push(`package.json: ${field}["${self}"] = "${pkg[field][self]}"`);
  }
}

// bundledDependencies / bundleDependencies are arrays of names, not maps.
for (const field of ["bundledDependencies", "bundleDependencies"]) {
  if (Array.isArray(pkg[field]) && pkg[field].includes(self)) {
    problems.push(`package.json: ${field} includes "${self}"`);
  }
}

let lock;
try {
  lock = read("package-lock.json");
} catch {
  lock = undefined; // no lockfile checked in — manifest check still applies
}

if (lock) {
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    // The root entry legitimately carries `name: <self>`; only its dep maps matter.
    for (const field of MANIFEST_FIELDS) {
      if (entry[field]?.[self]) {
        problems.push(`package-lock.json: ${path || "<root>"} → ${field}["${self}"]`);
      }
    }
    if (path === `node_modules/${self}`) {
      problems.push(`package-lock.json: resolved self as a tree entry (${entry.version})`);
    }
  }
}

if (problems.length > 0) {
  console.error(`\n${self} depends on itself:\n`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(
    "\nRemove the entry from package.json, then regenerate the lockfile:\n" +
      "  npm install --package-lock-only && npm prune\n" +
      "\nIf you meant to import the package's own public API, use a relative\n" +
      "path — the self-reference only resolves once published.\n",
  );
  process.exit(1);
}

console.log(`no self-dependency: ${self} clean`);
