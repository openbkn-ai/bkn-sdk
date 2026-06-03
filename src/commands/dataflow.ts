/** `openbkn dataflow …` — document/data flow workflows. */
import { Command } from "commander";
import { group } from "../help/grouped-help.js";
import { DEFAULT_LIST_LIMIT } from "../types.js";
import { printJson } from "../utils/output.js";
import { clientFrom, outputOptions } from "./_shared.js";

const int = (v: string) => Number.parseInt(v, 10);

function notImplemented(path: string): () => never {
  return () => {
    throw new Error(`\`openbkn dataflow ${path}\` is not implemented yet.`);
  };
}

export function dataflowCommand(): Command {
  const cmd = new Command("dataflow").description("Dataflow document workflows — list, runs, logs");

  cmd
    .command("list")
    .description("List all dataflows")
    .action(async (_opts, cmd: Command) => {
      printJson(await clientFrom(cmd).dataflows.list(), outputOptions(cmd));
    });

  cmd
    .command("runs <dagId>")
    .description("List run records for one dataflow")
    .option("--since <date>", "filter runs since a date")
    .action(async (dagId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).dataflows.runs(dagId, { since: opts.since }),
        outputOptions(cmd),
      );
    });

  cmd
    .command("logs <dagId> <instanceId>")
    .description("Show logs for one run")
    .option("--page <n>", "page", int, 0)
    .option("--limit <n>", "page size", int, DEFAULT_LIST_LIMIT)
    .action(async (dagId: string, instanceId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).dataflows.logs(dagId, instanceId, {
          page: opts.page,
          limit: opts.limit,
        }),
        outputOptions(cmd),
      );
    });

  cmd
    .command("run <dagId>")
    .description("Trigger a dataflow run from a remote file URL")
    .requiredOption("--url <url>", "remote file URL")
    .requiredOption("--name <name>", "file name")
    .action(async (dagId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).dataflows.run(dagId, opts.url, opts.name),
        outputOptions(cmd),
      );
    });

  // create flows + local-file trigger need verified multipart contracts (deferred).
  for (const name of ["templates", "create-dataset", "create-bkn", "create"]) {
    cmd
      .command(name)
      .description(`${name} (pending)`)
      .allowUnknownOption()
      .action(notImplemented(name));
  }

  return group(cmd, "AI DATA PLATFORM");
}
