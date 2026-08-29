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
  /** The command that hands out this id, for the ids that travel between commands. */
  from?: string;
}

/**
 * Where the ids that cross command boundaries come from. A caller holding none
 * of them otherwise has to guess which list command mints which, and the names
 * are consistent enough across 294 commands to answer it here rather than in
 * 223 argument descriptions.
 */
const ID_SOURCES: Record<string, string> = {
  "kn-id": "openbkn bkn list",
  "catalog-id": "openbkn vega catalog list",
  "resource-id": "openbkn vega catalog resources <catalog-id>",
  "ot-id": 'openbkn context search-schema <kn-id> "<q>"',
  "at-id": "openbkn bkn action-type list <kn-id>",
  "metric-id": "openbkn bkn metric list <kn-id>",
  "skill-id": "openbkn skill list",
  "box-id": "openbkn toolbox list",
  "tool-id": "openbkn tool list --toolbox <box-id>",
  "conversation-id": "openbkn trace conversations list",
  "trace-id": "openbkn trace search",
  "interaction-id": "openbkn trace interactions",
  "operation-id": "openbkn trace operations",
  "ot-ids": 'openbkn context search-schema <kn-id> "<q>"',
  "object-type-id": 'openbkn context search-schema <kn-id> "<q>"',
  "execution-id": "openbkn bkn action-log list <kn-id>",
  "receipt-id": "openbkn trace interactions operations <interaction-id>",
  "conversation-ids": "openbkn trace conversations list",
  "model-ids": "openbkn model llm list",
  "tool-ids": "openbkn tool list --toolbox <box-id>",
  "document-id": "openbkn vega resource document-get <resource-id> <document-id>",
  "document-ids": "openbkn context run-sql, or the ids you wrote",
};

/**
 * A bare `<id>` means whatever its group manages, so resolve it from the path
 * the command sits on rather than leaving the commonest argument name unsourced.
 */
const GROUP_ID_SOURCES: Array<[RegExp, string]> = [
  [/^vega catalog\b/, "openbkn vega catalog list"],
  [/^vega resource\b/, "openbkn vega catalog resources <catalog-id>"],
  [/^vega (discover-schedule|discover-task|semantic-task)\b/, "the sibling `list` command"],
  [/^vega dataset\b/, "openbkn vega dataset build-list"],
  [/^bkn action-schedule\b/, "openbkn bkn action-schedule list <kn-id>"],
  [/^vega connector-type\b/, "openbkn vega connector-type list"],
  [/^resource\b/, "openbkn resource list"],
  [/^skill\b/, "openbkn skill list (the `skill_id` field)"],
  [/^toolbox\b/, "openbkn toolbox list"],
  [/^tool\b/, "openbkn tool list --toolbox <box-id>"],
  [/^appkey\b/, "openbkn appkey list"],
  [/^admin org\b/, "openbkn admin org list"],
  [/^admin user\b/, "openbkn admin user list"],
  [/^admin role\b/, "openbkn admin role list"],
  [/^admin (llm|small-model)\b/, "the sibling `list` command"],
  [/^model (llm|small)\b/, "the sibling `list` command"],
  [/^bkn object-type\b/, "openbkn bkn object-type list <kn-id>"],
  [/^bkn relation-type\b/, "openbkn bkn relation-type list <kn-id>"],
  [/^bkn action-type\b/, "openbkn bkn action-type list <kn-id>"],
  [/^bkn concept-group\b/, "openbkn bkn concept-group list <kn-id>"],
  [/^bkn action-schedule\b/, "openbkn bkn action-schedule list <kn-id>"],
  [/^bkn action-log\b/, "openbkn bkn action-log list <kn-id>"],
];

/** Where an argument's value comes from: by name first, then by the group it sits in. */
function sourceOf(argName: string, path: string[]): string | undefined {
  const byName = ID_SOURCES[argName];
  if (byName) return byName;
  const generic =
    /^(id|ids|cg-id|modelid|role|user|schedule-id|schedule-ids|task-id|log-id)$/i.test(argName);
  if (!generic) return undefined;
  const parent = path.slice(0, -1).join(" ");
  return GROUP_ID_SOURCES.find(([re]) => re.test(parent))?.[1];
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
            ...(sourceOf(arg.name(), path) ? { from: sourceOf(arg.name(), path) } : {}),
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

/**
 * What each field in this document means. Shipped with every view, including a
 * subtree, so a reader never has to infer what `from` or `hasCommands` are for.
 */
const FIELD_MEANINGS: Record<string, string> = {
  path: "full command path — run it as `openbkn <path>`",
  section: "which section the command sits in; see `sections`",
  summary: "what the command does; often names the shape it answers with",
  hasCommands: "this walk stopped here — ask for this path to see deeper",
  arguments: "positional arguments, in order",
  "arguments[].from": "the command that hands out this argument's value",
  options: "flags; `mandatory` means the flag itself is required",
  guide: "prose the command's own --help prints under its command list",
  commands: "nested commands",
};

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
    // A subtree carries the legends too — it is often the only view a caller reads.
    return {
      sections: SECTION_MEANINGS,
      fields: FIELD_MEANINGS,
      ...describeNode(resolve(program, opts.path), opts.path.slice(0, -1), depth + 1),
    };
  }
  const top = program.commands.filter(
    (c) => !c.name().startsWith("help") && c.name() !== "describe",
  );
  return {
    name: program.name(),
    version: program.version(),
    summary: program.description(),
    sections: SECTION_MEANINGS,
    fields: FIELD_MEANINGS,
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
    path?: string;
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
  // A subtree names itself with `path`, and keeps that header row; the
  // whole-tree view has no path of its own and starts at the roots.
  const nodes = root.path ? [tree as DescribedCommand] : (root.commands ?? []);
  const truncated = nodes.some(function deeper(n: DescribedCommand): boolean {
    return Boolean(n.hasCommands) || (n.commands ?? []).some(deeper);
  });
  const table = nodes.flatMap((node) => rows(node));
  const nameWidth = Math.max(...table.map((r) => r.indent.length + r.name.length));
  const sectionWidth = Math.max(...table.map((r) => r.section.length));
  for (const r of table) {
    const name = `${r.indent}${r.name}`.padEnd(nameWidth);
    out.push(`${name}  ${r.section.padEnd(sectionWidth)}  ${r.summary}`.trimEnd());
  }
  // Without this the ellipsis is decoration; with it, it is an instruction.
  if (truncated) {
    out.push("", "… has subcommands — `openbkn describe <command>`, or raise --depth");
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
