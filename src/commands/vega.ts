/** `openbkn vega …` — Catalog reads + index BuildTask. */
import { Command } from "commander";
import type { SqlQueryRequest } from "../api/vega.js";
import { group } from "../help/grouped-help.js";
import { DEFAULT_LIST_LIMIT } from "../types.js";
import { InputError } from "../utils/errors.js";
import { printJson } from "../utils/output.js";
import { clientFrom, csv, outputOptions } from "./_shared.js";

const int = (v: string) => Number.parseInt(v, 10);

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
  catalog
    .command("get <id>")
    .description("Get a catalog by id")
    .action(async (id: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).vega.getCatalog(id), outputOptions(cmd));
    });
  catalog
    .command("resources <id>")
    .description("List resources under a catalog")
    .option("--category <c>", "filter by category (e.g. table)")
    .action(async (id: string, opts, cmd: Command) => {
      printJson(await clientFrom(cmd).vega.catalogResources(id, opts.category), outputOptions(cmd));
    });
  catalog
    .command("health <ids...>")
    .description("Health-status for one or more catalogs")
    .action(async (ids: string[], _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).vega.catalogHealth(ids), outputOptions(cmd));
    });
  catalog
    .command("create")
    .description("Create a catalog (data source)")
    .requiredOption("--name <s>", "catalog name")
    .requiredOption("--connector-type <s>", "connector type (e.g. mysql)")
    .requiredOption("--connector-config <json>", "connector config JSON")
    .option("--tags <t1,t2>", "comma-separated tags")
    .option("--description <s>", "description")
    .option("--enabled", "create enabled (default: disabled)")
    .action(async (opts, cmd: Command) => {
      let connectorConfig: unknown;
      try {
        connectorConfig = JSON.parse(opts.connectorConfig);
      } catch {
        throw new Error("--connector-config must be valid JSON");
      }
      printJson(
        await clientFrom(cmd).vega.createCatalog({
          name: opts.name,
          connectorType: opts.connectorType,
          connectorConfig,
          tags: opts.tags
            ? String(opts.tags)
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean)
            : undefined,
          description: opts.description,
          enabled: opts.enabled ? true : undefined,
        }),
        outputOptions(cmd),
      );
    });
  catalog
    .command("enable <id>")
    .description("Enable a catalog (required before discovery)")
    .action(async (id: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).vega.enableCatalog(id), outputOptions(cmd));
    });
  catalog
    .command("discover <id>")
    .description("Trigger catalog resource discovery")
    .option("--wait", "wait for discovery to complete")
    .action(async (id: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).vega.discoverCatalog(id, Boolean(opts.wait)),
        outputOptions(cmd),
      );
    });

  const connector = vega.command("connector-type").description("Connector types");
  connector
    .command("list")
    .description("List connector types")
    .action(async (_opts, cmd: Command) => {
      printJson(await clientFrom(cmd).vega.connectorTypes(), outputOptions(cmd));
    });
  connector
    .command("get <type>")
    .description("Get a connector type")
    .action(async (type: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).vega.connectorType(type), outputOptions(cmd));
    });

  vega
    .command("sql")
    .description("Run SQL / OpenSearch DSL directly against a vega-backend data source")
    .option(
      "--resource-type <type>",
      "source type (mysql | postgresql | opensearch | …); optional — inferred from the {{<id>}} placeholder",
    )
    .option(
      "--query <sql>",
      "SQL string; reference a resource with a {{<resource-id>}} placeholder",
    )
    .option("--stream-size <n>", "streaming batch size (100–10000)", int)
    .option("--query-timeout <s>", "query timeout in seconds (1–3600)", int)
    .option(
      "-d, --data <json>",
      "full request body as JSON (advanced; wins over --query/--resource-type)",
    )
    .action(async (opts, cmd: Command) => {
      let body: SqlQueryRequest;
      if (opts.data) {
        try {
          body = JSON.parse(opts.data);
        } catch {
          throw new InputError("--data must be valid JSON");
        }
      } else {
        if (!opts.query) {
          throw new InputError("Provide --query (and optionally --resource-type), or --data.");
        }
        body = {
          query: opts.query,
          // Optional — the backend infers the type from the {{<id>}} placeholder's
          // catalog connector when omitted.
          ...(opts.resourceType ? { resource_type: opts.resourceType } : {}),
          ...(opts.streamSize !== undefined ? { stream_size: opts.streamSize } : {}),
          ...(opts.queryTimeout !== undefined ? { query_timeout: opts.queryTimeout } : {}),
        };
      }
      printJson(await clientFrom(cmd).vega.sql(body), outputOptions(cmd));
    });

  const resource = vega.command("resource").description("Vega-backend resources");
  resource
    .command("list")
    .description("List resources")
    .option("--datasource-id <id>", "filter by catalog/datasource id")
    .option("--catalog-id <id>", "alias of --datasource-id")
    .option("--type <category>", "resource category")
    .option("--category <category>", "alias of --type")
    .option("--limit <n>", "page size", (v) => Number.parseInt(v, 10), DEFAULT_LIST_LIMIT)
    .action(async (opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).resource.list({
          datasourceId: opts.datasourceId ?? opts.catalogId,
          category: opts.type ?? opts.category,
          limit: opts.limit,
        }),
        outputOptions(cmd),
      );
    });
  resource
    .command("get <id>")
    .description("Get a resource")
    .action(async (id: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).resource.get(id), outputOptions(cmd));
    });
  resource
    .command("query <id>")
    .description("Fetch data rows from a resource")
    .option("--limit <n>", "row limit", (v) => Number.parseInt(v, 10), 50)
    .option("--offset <n>", "row offset", (v) => Number.parseInt(v, 10), 0)
    .action(async (id: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).resource.query(id, { limit: opts.limit, offset: opts.offset }),
        outputOptions(cmd),
      );
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
