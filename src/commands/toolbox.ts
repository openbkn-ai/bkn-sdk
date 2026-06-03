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

  cmd
    .command("create")
    .description("Create a toolbox")
    .requiredOption("--name <name>", "toolbox name")
    .requiredOption("--service-url <url>", "tool service URL")
    .option("--description <d>", "description")
    .action(async (opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).toolboxes.create({
          name: opts.name,
          serviceUrl: opts.serviceUrl,
          description: opts.description,
        }),
        outputOptions(cmd),
      );
    });

  cmd
    .command("publish <box-id>")
    .description("Publish a toolbox")
    .action(async (id: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).toolboxes.publish(id), outputOptions(cmd));
    });

  cmd
    .command("unpublish <box-id>")
    .description("Unpublish a toolbox (status=draft)")
    .action(async (id: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).toolboxes.unpublish(id), outputOptions(cmd));
    });

  cmd
    .command("delete <box-id>")
    .description("Delete a toolbox")
    .option("-y, --yes", "skip confirmation")
    .action(async (id: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).toolboxes.delete(id), outputOptions(cmd));
    });

  // export/import are .adp file ops — multipart/file contracts deferred.
  for (const name of ["export", "import"]) {
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

  cmd
    .command("enable <tool-ids...>")
    .description("Enable one or more tools")
    .requiredOption("--toolbox <box-id>", "toolbox id")
    .action(async (toolIds: string[], opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).toolboxes.setToolStatus(opts.toolbox, toolIds, "enabled"),
        outputOptions(cmd),
      );
    });

  cmd
    .command("disable <tool-ids...>")
    .description("Disable one or more tools")
    .requiredOption("--toolbox <box-id>", "toolbox id")
    .action(async (toolIds: string[], opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).toolboxes.setToolStatus(opts.toolbox, toolIds, "disabled"),
        outputOptions(cmd),
      );
    });

  // upload (multipart) + execute/debug (per-tool invoke contracts) deferred.
  for (const name of ["upload", "execute", "debug"]) {
    cmd
      .command(name)
      .description(`${name} (pending)`)
      .allowUnknownOption()
      .action(notImplemented("tool", name));
  }

  return group(cmd, "DECISION AGENT");
}
