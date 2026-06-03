/** `openbkn vega …` — Catalog reads + index BuildTask. */
import { Command } from "commander";
import { group } from "../help/grouped-help.js";
import { DEFAULT_LIST_LIMIT } from "../types.js";
import { printJson } from "../utils/output.js";
import { clientFrom, csv, outputOptions } from "./_shared.js";

export function vegaCommand(): Command {
  const vega = new Command("vega").description(
    "Vega observability — catalog, resources, index build tasks",
  );

  const catalog = vega.command("catalog").description("Catalog entries");
  catalog
    .command("list")
    .description("List catalog entries")
    .option("--limit <n>", "page size", (v) => Number.parseInt(v, 10), DEFAULT_LIST_LIMIT)
    .option("--offset <n>", "page offset", (v) => Number.parseInt(v, 10), 0)
    .action(async (_opts, cmd: Command) => {
      const o = cmd.optsWithGlobals();
      const data = await clientFrom(cmd).vega.catalogs({ limit: o.limit, offset: o.offset });
      printJson(data, outputOptions(cmd));
    });

  const dataset = vega.command("dataset").description("Dataset index build tasks");
  dataset
    .command("build <resource-id>")
    .description("Build a resource's index (creates a BuildTask)")
    .requiredOption("--mode <mode>", "build mode: batch | streaming")
    .option("--embedding-fields <list>", "comma-separated fields to vectorize")
    .option(
      "--build-key-fields <list>",
      "comma-separated key fields (batch: time; streaming: row id)",
    )
    .option("--embedding-model <id>", "embedding model id (default if omitted)")
    .option("--model-dimensions <n>", "vector dimensions", (v) => Number.parseInt(v, 10))
    .option("--wait", "poll until the build reaches a terminal state")
    .option("--timeout <s>", "wait timeout in seconds", (v) => Number.parseInt(v, 10), 300)
    .action(async (resourceId: string, _opts, cmd: Command) => {
      const o = cmd.optsWithGlobals();
      const task = await clientFrom(cmd).vega.build(
        {
          resource_id: resourceId,
          mode: o.mode,
          embedding_fields: csv(o.embeddingFields),
          build_key_fields: csv(o.buildKeyFields),
          embedding_model: o.embeddingModel,
          model_dimensions: o.modelDimensions,
        },
        { wait: Boolean(o.wait), timeoutMs: o.timeout * 1000 },
      );
      printJson(task, outputOptions(cmd));
    });

  dataset
    .command("build-status <resource-id> <task-id>")
    .description("Show a BuildTask's state and progress")
    .action(async (_resourceId: string, taskId: string, _opts, cmd: Command) => {
      const task = await clientFrom(cmd).vega.buildStatus(taskId);
      printJson(task, outputOptions(cmd));
    });

  return group(vega, "AI DATA PLATFORM");
}
