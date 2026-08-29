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
import { printJson } from "../utils/output.js";
import { outputOptions } from "./_shared.js";

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
  aliases: string[];
  section: string;
  summary: string;
  arguments: DescribedArgument[];
  options: DescribedOption[];
  guide?: string;
  commands: DescribedCommand[];
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

function describeNode(cmd: Command, parentPath: string[]): DescribedCommand {
  const path = [...parentPath, cmd.name()];
  const visible = cmd.commands.filter((c) => !c.name().startsWith("help"));
  return {
    path: path.join(" "),
    name: cmd.name(),
    aliases: cmd.aliases(),
    section: sectionOf(cmd),
    summary: cmd.description(),
    arguments: cmd.registeredArguments.map((arg) => ({
      name: arg.name(),
      required: arg.required,
      variadic: arg.variadic,
      ...(arg.description ? { description: arg.description } : {}),
    })),
    options: cmd.options.filter((o) => o.long !== "--help").map(describeOption),
    ...(guideOf(cmd) ? { guide: guideOf(cmd) } : {}),
    commands: visible.map((child) => describeNode(child, path)),
  };
}

export function describeCommandTree(program: Command): unknown {
  const top = program.commands.filter(
    (c) => !c.name().startsWith("help") && c.name() !== "describe",
  );
  return {
    name: program.name(),
    version: program.version(),
    summary: program.description(),
    sections: SECTION_MEANINGS,
    guide: guideOf(program),
    globalOptions: program.options.filter((o) => o.long !== "--help").map(describeOption),
    commands: top.map((cmd) => describeNode(cmd, [])),
  };
}

export function describeCommand(program: Command): Command {
  const cmd = new Command("describe")
    .description("Print the whole command tree as JSON — paths, arguments, flags, sections")
    .action((_opts, self: Command) => {
      printJson(describeCommandTree(program), { ...outputOptions(self), json: true });
    });
  return group(cmd, "COMMANDS");
}
