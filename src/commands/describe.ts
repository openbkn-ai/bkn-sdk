// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * `openbkn describe` — the command tree as data.
 *
 * `--help` is prose: an agent that wants the whole surface has to run it once
 * per node and parse columns, and prose blocks look exactly like command rows
 * to a parser. This walks the same tree commander already holds and prints it
 * as JSON, carrying the section each command was tagged with and the guidance
 * attached to it, so a caller can enumerate what exists without scraping.
 */
import { Command, type Option } from "commander";
import { SECTION_MEANINGS, group, guideOf, sectionOf } from "../help/grouped-help.js";
import { InputError } from "../utils/errors.js";
import { printJson } from "../utils/output.js";
import { outputOptions } from "./_shared.js";

/** Commands that have not been sorted yet render without a section label. */
const DEFAULT_SECTION = "COMMANDS";

interface DescribedArgument {
  name: string;
  required: boolean;
  variadic: boolean;
  description?: string;
}

interface DescribedOption {
  flags: string;
  description: string;
  /** The flag itself must be supplied. */
  mandatory: boolean;
  /** The flag takes a value (`--flag <v>`) rather than standing alone. */
  takesValue: boolean;
  default?: unknown;
}

interface DescribedCommand {
  path: string;
  name: string;
  section: string;
  summary: string;
  /** Only on a node the walk stopped at, so a reader knows to ask for more. */
  hasCommands?: boolean;
  aliases?: string[];
  arguments?: DescribedArgument[];
  options?: DescribedOption[];
  guide?: string;
  commands?: DescribedCommand[];
}

function describeOption(opt: Option): DescribedOption {
  return {
    flags: opt.flags,
    description: opt.description,
    mandatory: Boolean(opt.mandatory),
    takesValue: Boolean(opt.required || opt.optional),
    ...(opt.defaultValue === undefined ? {} : { default: opt.defaultValue }),
  };
}

function describeNode(cmd: Command, parentPath: string[], depth: number): DescribedCommand {
  const path = [...parentPath, cmd.name()];
  const children = cmd.commands.filter((c) => !c.name().startsWith("help"));
  const skeleton: DescribedCommand = {
    path: path.join(" "),
    name: cmd.name(),
    section: sectionOf(cmd),
    summary: cmd.description(),
  };
  // At the depth boundary a reader wants the map, not every flag of every node.
  if (depth <= 0) return children.length ? { ...skeleton, hasCommands: true } : skeleton;

  const aliases = cmd.aliases();
  const options = cmd.options.filter((o) => o.long !== "--help");
  return {
    ...skeleton,
    ...(aliases.length ? { aliases } : {}),
    ...(cmd.registeredArguments.length
      ? {
          arguments: cmd.registeredArguments.map((arg) => ({
            name: arg.name(),
            required: arg.required,
            variadic: arg.variadic,
            ...(arg.description ? { description: arg.description } : {}),
          })),
        }
      : {}),
    ...(options.length ? { options: options.map(describeOption) } : {}),
    ...(guideOf(cmd) ? { guide: guideOf(cmd) } : {}),
    ...(children.length
      ? { commands: children.map((child) => describeNode(child, path, depth - 1)) }
      : {}),
  };
}

export interface DescribeOptions {
  /** Only this subtree, given as a command path (`bkn metric`). */
  path?: string[];
  /** How many levels to walk. 1 lists a node's own commands without their children. */
  depth?: number;
}

/** Walk to the node a path names, so `describe bkn metric` ships only that subtree. */
function resolve(program: Command, path: string[]): Command {
  let node = program;
  for (const name of path) {
    const child = node.commands.find((c) => c.name() === name || c.aliases().includes(name));
    if (!child) throw new InputError(`no such command: ${path.join(" ")}`);
    node = child;
  }
  return node;
}

export function describeCommandTree(program: Command, opts: DescribeOptions = {}): unknown {
  // `--depth 1` means "this level only", so the count is spent on the node itself.
  const depth = opts.depth === undefined ? Number.MAX_SAFE_INTEGER : opts.depth - 1;
  if (opts.path?.length) {
    return describeNode(resolve(program, opts.path), opts.path.slice(0, -1), depth + 1);
  }
  const top = program.commands.filter(
    (c) => !c.name().startsWith("help") && c.name() !== "describe",
  );
  return {
    name: program.name(),
    version: program.version(),
    summary: program.description(),
    sections: SECTION_MEANINGS,
    commands: top.map((cmd) => describeNode(cmd, [], depth)),
    globalOptions: program.options.filter((o) => o.long !== "--help").map(describeOption),
    guide: guideOf(program),
  };
}

interface Column {
  indent: string;
  name: string;
  section: string;
  summary: string;
}

/** One row per command. A trailing `…` means the node nests further than this walk went. */
function rows(node: DescribedCommand, indent = ""): Column[] {
  const out: Column[] = [
    {
      indent,
      name: `${node.path.split(" ").pop()}${node.hasCommands ? " …" : ""}`,
      section: node.section === DEFAULT_SECTION ? "" : node.section,
      summary: node.summary,
    },
  ];
  for (const child of node.commands ?? []) out.push(...rows(child, `${indent}  `));
  return out;
}

function renderText(tree: unknown): string {
  const root = tree as {
    sections?: Record<string, string>;
    commands?: DescribedCommand[];
  };
  const out: string[] = [];
  if (root.sections) {
    const width = Math.max(...Object.keys(root.sections).map((k) => k.length));
    out.push("SECTIONS");
    for (const [name, meaning] of Object.entries(root.sections)) {
      out.push(`  ${name.padEnd(width)}  ${meaning}`);
    }
    out.push("");
  }
  // The whole-tree view starts at the roots; a subtree view keeps its own header.
  const nodes = root.sections ? (root.commands ?? []) : [tree as DescribedCommand];
  const table = nodes.flatMap((node) => rows(node));
  const nameWidth = Math.max(...table.map((r) => r.indent.length + r.name.length));
  const sectionWidth = Math.max(...table.map((r) => r.section.length));
  for (const r of table) {
    const name = `${r.indent}${r.name}`.padEnd(nameWidth);
    out.push(`${name}  ${r.section.padEnd(sectionWidth)}  ${r.summary}`.trimEnd());
  }
  return out.join("\n");
}

export function describeCommand(program: Command): Command {
  const cmd = new Command("describe")
    .description("Print the command tree — paths, sections, flags (--json for the data)")
    .argument("[command...]", "only this subtree, e.g. `describe bkn metric`")
    .option("--depth <n>", "how many levels to walk (1 = this level only)", (v) =>
      Number.parseInt(v, 10),
    )
    .option("--pretty", "indent the JSON instead of packing it onto one line")
    .action((path: string[], opts, self: Command) => {
      const tree = describeCommandTree(program, { path, depth: opts.depth });
      const out = outputOptions(self);
      if (!out.json && !out.compact && !opts.pretty) {
        process.stdout.write(`${renderText(tree)}\n`);
        return;
      }
      printJson(tree, { ...out, json: Boolean(opts.pretty), compact: !opts.pretty });
    });
  return group(cmd, "COMMANDS");
}
