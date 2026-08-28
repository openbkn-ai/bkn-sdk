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

function guideOf(cmd: Command): string | undefined {
  return (cmd as unknown as Record<symbol, string | undefined>)[GUIDE];
}

function groupOf(cmd: Command): string {
  return (cmd as unknown as Record<symbol, string>)[GROUP] ?? DEFAULT_GROUP;
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
    for (const [name, cmds] of sections) {
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
  const apply = (cmd: Command): void => {
    cmd.configureHelp({ formatHelp });
    for (const child of cmd.commands) apply(child);
  };
  apply(root);
}
