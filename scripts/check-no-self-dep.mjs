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

/** True if `spec` aliases the package under another name (`npm:<self>@...`). */
const isSelfAlias = (spec) => typeof spec === "string" && spec.startsWith(`npm:${self}@`);

/**
 * Walk a dependency map. `in` — not truthiness — decides: `""` is a falsy but
 * perfectly installable spec (an empty range means `*`). Values matter too, or
 * an alias smuggles the package back in under a different key. `overrides`
 * nests arbitrarily, so recurse.
 */
function scanMap(map, where) {
  if (!map || typeof map !== "object") return;
  if (self in map) problems.push(`${where}["${self}"] = ${JSON.stringify(map[self])}`);
  for (const [name, spec] of Object.entries(map)) {
    if (isSelfAlias(spec)) problems.push(`${where}["${name}"] = ${JSON.stringify(spec)} (alias)`);
    // A nested object is an `overrides` sub-tree keyed by the parent package.
    if (spec && typeof spec === "object") scanMap(spec, `${where}["${name}"]`);
  }
}

for (const field of MANIFEST_FIELDS) {
  scanMap(pkg[field], `package.json: ${field}`);
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
      scanMap(entry[field], `package-lock.json: ${path || "<root>"} → ${field}`);
    }
    // An alias installs under its alias key, so the path alone misses it — the
    // entry's own `name` is what says which package actually landed there.
    if (path === `node_modules/${self}` || (path && entry.name === self)) {
      problems.push(`package-lock.json: resolved self as a tree entry at ${path}`);
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
