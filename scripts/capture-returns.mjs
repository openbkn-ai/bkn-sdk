#!/usr/bin/env node
// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * Record what each read command actually answers with, from a live deploy.
 *
 * A caller cannot parse a response they have to run the command to see, and the
 * shapes are not uniform enough to state once: `{entries, total_count}` for most
 * lists, `{data, count}` for models, a bare array for `resource find`. Rather
 * than restate 300 descriptions by hand — and get them wrong — this walks the
 * tree, resolves each argument through the `from` the CLI itself declares, runs
 * the command, and writes the top-level keys to `src/help/returns.json`, which
 * `describe` ships.
 *
 * Read-only: RUN and WRITE commands are never invoked. Re-run against a deploy
 * with representative data when the surface changes:
 *
 *     npm run build && node scripts/capture-returns.mjs
 */
import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
import { promisify } from "node:util";

const run = promisify(execFile);
const CLI = "dist/cli.js";
const OUT = "src/help/returns.json";

async function cli(args) {
  try {
    const { stdout } = await run("node", [CLI, ...args, "--json"], {
      maxBuffer: 32 * 1024 * 1024,
    });
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

const tree = await cli(["describe"]);
if (!tree) {
  console.error("describe failed — is the CLI built and a session active?");
  process.exit(1);
}

const leaves = [];
(function walk(cmds) {
  for (const c of cmds) c.commands?.length ? walk(c.commands) : leaves.push(c);
})(tree.commands);

/** Pull a usable id out of whatever envelope a source command answered with. */
const LIST_KEYS = ["entries", "data", "tools", "keys", "roles", "users", "departments"];
function pickId(payload, argName) {
  if (!payload) return null;
  const rows = Array.isArray(payload)
    ? payload
    : LIST_KEYS.map((k) => payload[k]).find((v) => Array.isArray(v) && v.length);
  const row = rows?.[0];
  if (!row || typeof row !== "object") return null;
  const want = argName.replace(/-/g, "_").toLowerCase();
  const candidates = [want, `${want}_id`, `${want.replace(/_id$/, "")}_id`, "id", "concept_id"];
  for (const key of candidates) {
    const hit = Object.entries(row).find(
      ([k, v]) => k.toLowerCase() === key && typeof v === "string" && v,
    );
    if (hit) return hit[1];
  }
  const anyId = Object.entries(row).find(
    ([k, v]) => k.endsWith("_id") && typeof v === "string" && v,
  );
  return anyId?.[1] ?? null;
}

const resolved = new Map();
async function resolveArg(name, from, depth = 0) {
  if (!from || depth > 3) return null;
  const key = `${name}|${from}`;
  if (resolved.has(key)) return resolved.get(key);
  const parts = from.replace(/^openbkn /, "").split(" ");
  const argv = [];
  for (const part of parts) {
    const placeholder = part.match(/^<([a-z-]+)>$/);
    if (placeholder) {
      const inner = placeholder[1];
      const innerFrom = leaves
        .flatMap((c) => c.arguments ?? [])
        .find((a) => a.name === inner && a.from)?.from;
      const value = await resolveArg(inner, innerFrom, depth + 1);
      if (!value) return null;
      argv.push(value);
    } else if (part.startsWith('"')) {
      argv.push("test");
    } else {
      argv.push(part);
    }
  }
  const value = pickId(await cli(argv), name);
  resolved.set(key, value);
  return value;
}

const returns = {};
let attempted = 0;
/**
 * READ means "changes nothing on the platform" — it says nothing about the
 * local filesystem. `bkn pull` reads a network and unpacks it into the working
 * directory, which once put 77 downloaded files into this repository.
 */
const WRITES_LOCALLY = new Set([
  "bkn pull",
  "bkn export",
  "skill download",
  "skill install",
  "toolbox export",
]);

for (const cmd of leaves) {
  if (cmd.section !== "READ") continue;
  if (WRITES_LOCALLY.has(cmd.path)) continue;
  if ((cmd.options ?? []).some((o) => o.mandatory)) continue;
  const argv = cmd.path.split(" ");
  let ok = true;
  for (const arg of (cmd.arguments ?? []).filter((a) => a.required)) {
    const value = await resolveArg(arg.name, arg.from);
    if (!value) {
      ok = false;
      break;
    }
    argv.push(value);
  }
  if (!ok) continue;
  attempted += 1;
  const payload = await cli(argv);
  if (payload === null) continue;
  returns[cmd.path] = Array.isArray(payload) ? "array" : Object.keys(payload).sort();
}

writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      note: "Top-level keys observed on a live deploy, not a contract. Regenerate with scripts/capture-returns.mjs.",
      observedAt: new Date().toISOString().slice(0, 10),
      commands: returns,
    },
    null,
    2,
  )}\n`,
);
console.log(`captured ${Object.keys(returns).length} of ${attempted} attempted → ${OUT}`);
