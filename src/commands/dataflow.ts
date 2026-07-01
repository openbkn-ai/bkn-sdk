// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the OpenBKN License. See the LICENSE file in the project root.

/** `openbkn dataflow …` — document/data flow workflows. */
import { Command } from "commander";
import { group } from "../help/grouped-help.js";
import { DEFAULT_LIST_LIMIT } from "../types.js";
import { printJson } from "../utils/output.js";
import { clientFrom, outputOptions, readBody } from "./_shared.js";

const int = (v: string) => Number.parseInt(v, 10);

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

  cmd
    .command("create")
    .description("Create a dataflow (DAG) from a full document body (--body / --body-file)")
    .option("--body <json>", "dataflow document JSON")
    .option("--body-file <path>", "read the dataflow document JSON from a file")
    .action(async (opts, cmd: Command) => {
      printJson(await clientFrom(cmd).dataflows.create(readBody(opts)), outputOptions(cmd));
    });

  const parseSet = (pairs: string[] | undefined): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const item of pairs ?? []) {
      const i = item.indexOf("=");
      if (i > 0) out[item.slice(0, i)] = item.slice(i + 1);
    }
    return out;
  };
  cmd
    .command("templates")
    .description("List available dataset/bkn/dataflow templates")
    .action(async (_opts, cmd: Command) => {
      printJson(clientFrom(cmd).dataflows.templates(), outputOptions(cmd));
    });
  cmd
    .command("create-dataset")
    .description("Create a dataset from a template (--template <name> --set k=v ...)")
    .requiredOption("--template <name>", "template name")
    .option(
      "--set <kv...>",
      "set a template argument (key=value); repeatable",
      (v, acc: string[]) => {
        acc.push(v);
        return acc;
      },
      [] as string[],
    )
    .action(async (opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).dataflows.createDataset(opts.template, parseSet(opts.set)),
        outputOptions(cmd),
      );
    });
  cmd
    .command("create-bkn")
    .description("Create a knowledge network from a template (--template <name> --set k=v ...)")
    .requiredOption("--template <name>", "template name")
    .option(
      "--set <kv...>",
      "set a template argument (key=value); repeatable",
      (v, acc: string[]) => {
        acc.push(v);
        return acc;
      },
      [] as string[],
    )
    .action(async (opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).dataflows.createBkn(opts.template, parseSet(opts.set)),
        outputOptions(cmd),
      );
    });

  return group(cmd, "AI DATA PLATFORM");
}
