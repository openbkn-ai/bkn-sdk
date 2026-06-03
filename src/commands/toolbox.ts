/** `openbkn toolbox …` and `openbkn tool …` — agent toolboxes + tools. */
import { Command } from "commander";
import { group } from "../help/grouped-help.js";
import { DEFAULT_LIST_LIMIT } from "../types.js";
import { InputError } from "../utils/errors.js";
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

  const invokeOpts = (c: Command) =>
    c
      .requiredOption("--toolbox <box-id>", "toolbox id")
      .option("--body <json>", "request body JSON")
      .option("--header <json>", "headers map JSON")
      .option("--query <json>", "query params JSON")
      .option("--path <json>", "path params JSON")
      .option("--timeout <s>", "per-call timeout seconds", int);

  const parseJson = (s: string | undefined, label: string): Record<string, unknown> | undefined => {
    if (!s) return undefined;
    try {
      return JSON.parse(s);
    } catch {
      throw new InputError(`--${label} must be valid JSON`);
    }
  };

  const buildEnvelope = (opts: Record<string, string | undefined>) => ({
    body: opts.body ? JSON.parse(opts.body) : undefined,
    header: parseJson(opts.header, "header"),
    query: parseJson(opts.query, "query"),
    path: parseJson(opts.path, "path"),
    timeout: opts.timeout ? Number(opts.timeout) : undefined,
  });

  invokeOpts(
    cmd.command("execute <tool-id>").description("Invoke a published+enabled tool"),
  ).action(async (toolId: string, opts, cmd: Command) => {
    printJson(
      await clientFrom(cmd).toolboxes.execute(opts.toolbox, toolId, buildEnvelope(opts)),
      outputOptions(cmd),
    );
  });
  invokeOpts(
    cmd.command("debug <tool-id>").description("Invoke a tool (draft/disabled too)"),
  ).action(async (toolId: string, opts, cmd: Command) => {
    printJson(
      await clientFrom(cmd).toolboxes.debug(opts.toolbox, toolId, buildEnvelope(opts)),
      outputOptions(cmd),
    );
  });

  // upload (multipart OpenAPI spec) deferred.
  cmd
    .command("upload")
    .description("upload (pending)")
    .allowUnknownOption()
    .action(notImplemented("tool", "upload"));

  return group(cmd, "DECISION AGENT");
}
