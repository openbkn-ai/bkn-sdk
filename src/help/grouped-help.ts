// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * Grouped help formatter for commander — reproduces the legacy grouped layout
 * (section headers + USAGE / FLAGS) at every command level. One formatter, no
 * per-command help strings: each command carries a `group` tag read here.
 */
import type { Command, Help } from "commander";

const GROUP = Symbol("openbkn.group");
const GUIDE = Symbol("openbkn.guide");
const DEFAULT_GROUP = "COMMANDS";

/** Tag a command with the help section it belongs to. Returns the command. */
export function group(cmd: Command, name: string): Command {
  (cmd as unknown as Record<symbol, string>)[GROUP] = name;
  return cmd;
}

/**
 * Attach prose sections (first steps, task recipes, conventions) rendered
 * between the command list and FLAGS — where a reader looks after seeing what
 * exists but before hunting through flags. Commander's own `addHelpText`
 * can only append after everything, which buries it.
 */
export function guide(cmd: Command, text: string): Command {
  (cmd as unknown as Record<symbol, string>)[GUIDE] = text;
  return cmd;
}

/**
 * The only section names a subcommand list uses. Four, fixed, in this order,
 * so an agent learns the taxonomy once instead of per command group: GROUPS
 * holds nested command groups, READ changes nothing, RUN acts without changing
 * configuration, and WRITE changes platform state and deserves a confirmation.
 * Section order here is the order they render in, regardless of the order the
 * commands were registered.
 */
const SECTION_ORDER = ["GROUPS", "READ", "RUN", "WRITE"];

/**
 * Tag a parent's children in one place. A name not listed keeps the default
 * section, so a command added later shows up rather than disappearing.
 */
export function groupChildren(parent: Command, sections: Record<string, string[]>): void {
  for (const [section, names] of Object.entries(sections)) {
    for (const name of names) {
      const child = parent.commands.find((c) => c.name() === name);
      if (child) group(child, section);
    }
  }
}

/**
 * Where an untagged command lands. Structure first: anything with children is a
 * group. Then the verb, since this CLI names commands consistently — `list`,
 * `get`, `show` read; `query`, `execute`, `test` act; `create`, `delete`, `set`
 * write. A name matching nothing stays in the default section, which is visible
 * in the help and in `describe`, so the gap is findable rather than silent.
 */
const VERB_SECTIONS: Array<[RegExp, string]> = [
  [
    /^(list|get|show|find|files|history|members|roles|tree|names|content|read-file|status|whoami|users|detail|spans|graph|health|resources|search|market|market-get|stats|export|pull|validate-fixture)$/,
    "READ",
  ],
  [
    /^(query|execute|debug|run|test|chat|embeddings|rerank|diagnose|scan|discover|build|dry-run|validate|token|download|install|call|sql|receipt|fingerprint|test-connection|test-connection-config|attempt|retry|start|resume|ensure-current|create-new-generation|close|complete|fail|cancel|handoff|operations|build-status|build-list)$/,
    "RUN",
  ],
  [
    /^(create|update|delete|add|edit|remove|set|register|upload|publish|unpublish|republish|import|activate|login|logout|use|switch|change-password|enable|disable|push|assign-role|revoke-role|add-member|remove-member|reset-password|grant-perm|revoke-perm|add-members|remove-members|set-status|regenerate|revoke|set-bd|list-bd|build-start|build-stop|build-delete|publish-history|update-metadata|update-package|create-from-catalog|export-config)$/,
    "WRITE",
  ],
];

/** Classify every child a `groupChildren` call did not name. */
function autoGroup(parent: Command): void {
  for (const child of parent.commands) {
    if (child.name().startsWith("help")) continue;
    if ((child as unknown as Record<symbol, string>)[GROUP] !== undefined) continue;
    if (child.commands.filter((c) => !c.name().startsWith("help")).length > 0) {
      group(child, "GROUPS");
      continue;
    }
    const verb = VERB_SECTIONS.find(([re]) => re.test(child.name()));
    if (verb) group(child, verb[1]);
  }
}

/** Where a section sits in the fixed order; unknown names keep their own order after it. */
function rankOf(name: string): number {
  if (name === DEFAULT_GROUP) return Number.MAX_SAFE_INTEGER;
  const i = SECTION_ORDER.indexOf(name);
  return i === -1 ? SECTION_ORDER.length : i;
}

function groupOf(cmd: Command): string {
  return (cmd as unknown as Record<symbol, string>)[GROUP] ?? DEFAULT_GROUP;
}

/** What each fixed section means. The root help prints it; `describe` ships it. */
export const SECTION_MEANINGS: Record<string, string> = {
  GROUPS: "nested command groups — one level deeper",
  READ: "changes nothing",
  RUN: "acts without changing configuration (triggers a job, spends a model call, rotates a token)",
  WRITE: "changes platform state — confirm with a person first",
  [DEFAULT_GROUP]: "not sorted into a section yet",
};

/** The section a command was tagged with, for callers that render their own view. */
export function sectionOf(cmd: Command): string {
  return groupOf(cmd);
}

/** The prose block attached with {@link guide}, if any. */
export function guideOf(cmd: Command): string | undefined {
  return (cmd as unknown as Record<symbol, string | undefined>)[GUIDE];
}

function formatHelp(cmd: Command, helper: Help): string {
  const out: string[] = [];
  const desc = helper.commandDescription(cmd);
  if (desc) out.push(desc, "");

  out.push("USAGE", `  ${helper.commandUsage(cmd)}`, "");

  const subs = helper.visibleCommands(cmd);
  if (subs.length > 0) {
    const width = Math.max(...subs.map((c) => helper.subcommandTerm(c).length));
    const sections = new Map<string, Command[]>();
    for (const c of subs) {
      const g = groupOf(c);
      const bucket = sections.get(g);
      if (bucket) bucket.push(c);
      else sections.set(g, [c]);
    }
    // Known sections take the fixed order; anything else keeps the order its
    // first command was registered in, which is what the root help relies on.
    const ordered = [...sections.entries()]
      .map((entry, index) => ({ entry, index }))
      .sort((a, b) => rankOf(a.entry[0]) - rankOf(b.entry[0]) || a.index - b.index)
      .map(({ entry }) => entry);
    for (const [name, cmds] of ordered) {
      out.push(name);
      for (const c of cmds) {
        out.push(`  ${helper.subcommandTerm(c).padEnd(width)}  ${helper.subcommandDescription(c)}`);
      }
      out.push("");
    }
  }

  const extra = guideOf(cmd);
  if (extra) out.push(extra.trim(), "");

  const opts = helper.visibleOptions(cmd);
  if (opts.length > 0) {
    const width = Math.max(...opts.map((o) => helper.optionTerm(o).length));
    out.push("FLAGS");
    for (const o of opts) {
      out.push(`  ${helper.optionTerm(o).padEnd(width)}  ${helper.optionDescription(o)}`);
    }
    out.push("");
  }

  return out.join("\n");
}

/**
 * Apply the grouped formatter to a command and every descendant. Call AFTER all
 * subcommands are added — commander's `configureHelp` is per-command and is not
 * inherited through `addCommand`, so we set it on each node explicitly.
 */
export function installGroupedHelp(root: Command): void {
  const apply = (cmd: Command, path: string[]): void => {
    cmd.configureHelp({ formatHelp });
    if (cmd !== root) autoGroup(cmd);
    // Commander prints the whole help after a usage error, which buries the one
    // sentence that fixes it. Point at the description of what went wrong
    // instead — for a subcommand that is its own entry, ids and all.
    cmd.showHelpAfterError(
      path.length
        ? `Run \`openbkn describe ${path.join(" ")}\` to see its arguments and where their ids come from.`
        : "Run `openbkn describe --depth 1` for every command, or `openbkn --help` for the guide.",
    );
    for (const child of cmd.commands) apply(child, [...path, child.name()]);
  };
  apply(root, []);
}
