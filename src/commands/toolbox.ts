/** `openbkn toolbox …` and `openbkn tool …` — agent toolboxes + tools. */
import { Command } from "commander";
import { group } from "../help/grouped-help.js";
import { DEFAULT_LIST_LIMIT } from "../types.js";
import { printJson } from "../utils/output.js";
import { clientFrom, outputOptions } from "./_shared.js";

const int = (v: string) => Number.parseInt(v, 10);

function notImplemented(kind: string, name: string): () => never {
  return () => {
    throw new Error(`\`openbkn ${kind} ${name}\` is not implemented yet.`);
  };
}

export function toolboxCommand(): Command {
  const cmd = new Command("toolbox").description("Agent toolbox lifecycle");

  cmd
    .command("list")
    .description("List toolboxes")
    .option("--keyword <s>", "filter by keyword")
    .option("--limit <n>", "page size", int, DEFAULT_LIST_LIMIT)
    .option("--offset <n>", "page offset", int, 0)
    .action(async (opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).toolboxes.list({
          keyword: opts.keyword,
          limit: opts.limit,
          offset: opts.offset,
        }),
        outputOptions(cmd),
      );
    });

  for (const name of ["create", "publish", "unpublish", "delete", "export", "import"]) {
    cmd
      .command(name)
      .description(`${name} (pending)`)
      .allowUnknownOption()
      .action(notImplemented("toolbox", name));
  }

  return group(cmd, "DECISION AGENT");
}

export function toolCommand(): Command {
  const cmd = new Command("tool").description("Tools inside a toolbox");

  cmd
    .command("list")
    .description("List tools in a toolbox")
    .requiredOption("--toolbox <box-id>", "toolbox id")
    .action(async (opts, cmd: Command) => {
      printJson(await clientFrom(cmd).toolboxes.tools(opts.toolbox), outputOptions(cmd));
    });

  for (const name of ["upload", "enable", "disable", "execute", "debug"]) {
    cmd
      .command(name)
      .description(`${name} (pending)`)
      .allowUnknownOption()
      .action(notImplemented("tool", name));
  }

  return group(cmd, "DECISION AGENT");
}
