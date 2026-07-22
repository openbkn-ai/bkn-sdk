// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** `openbkn vega …` — Catalog reads + index BuildTask. */
import { Command } from "commander";
import type { SqlQueryRequest } from "../api/vega.js";
import { group } from "../help/grouped-help.js";
import { DEFAULT_LIST_LIMIT } from "../types.js";
import { InputError } from "../utils/errors.js";
import { printJson } from "../utils/output.js";
import { clientFrom, csv, outputOptions } from "./_shared.js";

const int = (v: string) => Number.parseInt(v, 10);
const parsePairs = (raw?: string): Array<{ key: string; value: string }> | undefined => {
  if (!raw) return undefined;
  return raw
    .split(",")
    .map((part) => {
      const idx = part.indexOf("=");
      if (idx < 1) throw new InputError("--extension must be key=value[,key=value]");
      return { key: part.slice(0, idx).trim(), value: part.slice(idx + 1).trim() };
    })
    .filter((p) => p.key.length > 0);
};

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
    .option("--name <s>", "filter by name")
    .option("--tag <s>", "filter by tag")
    .option("--type <type>", "filter by catalog type: physical | logical")
    .option("--enabled <bool>", "filter by enabled state")
    .option("--health-check-status <s>", "filter by health status")
    .option("--include-extensions", "include all extension key/value pairs")
    .option("--include-extension-keys <keys>", "include selected extension keys")
    .option("--extension <k=v,...>", "filter by extension key/value pairs")
    .option("--sort <field>", "sort field: name | create_time | update_time")
    .option("--direction <dir>", "sort direction: asc | desc")
    .action(async (_opts, cmd: Command) => {
      const o = cmd.optsWithGlobals();
      const data = await clientFrom(cmd).vega.catalogs({
        limit: o.limit,
        offset: o.offset,
        name: o.name,
        tag: o.tag,
        type: o.type,
        enabled: o.enabled === undefined ? undefined : o.enabled === "true",
        healthCheckStatus: o.healthCheckStatus,
        includeExtensions: o.includeExtensions,
        includeExtensionKeys: o.includeExtensionKeys,
        extensionPairs: parsePairs(o.extension),
        sort: o.sort,
        direction: o.direction,
      });
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
    .option("--limit <n>", "page size (backend default 20, max 1000; -1 = all)", int)
    .option("--offset <n>", "page offset", int, 0)
    .action(async (id: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).vega.catalogResources(id, opts.category, opts.limit, opts.offset),
        outputOptions(cmd),
      );
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
    .option("--id <id>", "explicit catalog id")
    .option("--tags <t1,t2>", "comma-separated tags")
    .option("--description <s>", "description")
    .option("--enabled", "create enabled (default: disabled)")
    .option("--internal", "create an internal catalog")
    .option("--extensions <json>", "extension key/value JSON object")
    .action(async (opts, cmd: Command) => {
      let connectorConfig: unknown;
      try {
        connectorConfig = JSON.parse(opts.connectorConfig);
      } catch {
        throw new Error("--connector-config must be valid JSON");
      }
      const extensions = opts.extensions ? JSON.parse(opts.extensions) : undefined;
      printJson(
        await clientFrom(cmd).vega.createCatalog({
          id: opts.id,
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
          internal: opts.internal ? true : undefined,
          extensions,
        }),
        outputOptions(cmd),
      );
    });
  catalog
    .command("update <id>")
    .description("Update a catalog")
    .option("--name <s>", "catalog name")
    .option("--connector-type <s>", "connector type")
    .option("--connector-config <json>", "connector config JSON")
    .option("--tags <t1,t2>", "comma-separated tags")
    .option("--description <s>", "description")
    .option("--enabled <bool>", "enabled state")
    .option("--extensions <json>", "extension key/value JSON object")
    .action(async (id: string, opts, cmd: Command) => {
      const connectorConfig = opts.connectorConfig ? JSON.parse(opts.connectorConfig) : undefined;
      const extensions = opts.extensions ? JSON.parse(opts.extensions) : undefined;
      printJson(
        await clientFrom(cmd).vega.updateCatalog(id, {
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
          enabled: opts.enabled === undefined ? undefined : opts.enabled === "true",
          extensions,
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
    .command("disable <id>")
    .description("Disable a catalog")
    .action(async (id: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).vega.disableCatalog(id), outputOptions(cmd));
    });
  catalog
    .command("delete <id>")
    .description("Delete a catalog")
    .action(async (id: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).vega.deleteCatalog(id), outputOptions(cmd));
    });
  catalog
    .command("test-connection <id>")
    .description("Test a catalog connection")
    .action(async (id: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).vega.testCatalogConnection(id), outputOptions(cmd));
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
    .requiredOption("--resource-type <type>", "source type (mysql | postgresql | opensearch | …)")
    .option("--query-type <type>", "query mode: standard | stream")
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
          resource_type: opts.resourceType,
          ...(opts.queryType ? { query_type: opts.queryType } : {}),
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
    .option("--status <status>", "filter by status")
    .option("--database <name>", "filter by database")
    .option("--limit <n>", "page size", (v) => Number.parseInt(v, 10), DEFAULT_LIST_LIMIT)
    .option("--offset <n>", "page offset", int, 0)
    .option("--include-extensions", "include all extension key/value pairs")
    .option("--include-extension-keys <keys>", "include selected extension keys")
    .option("--extension <k=v,...>", "filter by extension key/value pairs")
    .option("--sort <field>", "sort field: name | create_time | update_time")
    .option("--direction <dir>", "sort direction: asc | desc")
    .action(async (opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).resource.list({
          datasourceId: opts.datasourceId ?? opts.catalogId,
          category: opts.type ?? opts.category,
          status: opts.status,
          database: opts.database,
          limit: opts.limit,
          offset: opts.offset,
          includeExtensions: opts.includeExtensions,
          includeExtensionKeys: opts.includeExtensionKeys,
          extensionPairs: parsePairs(opts.extension),
          sort: opts.sort,
          direction: opts.direction,
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
    .option("--embedding-model <id>", "default embedding model name/id")
    .option("--fulltext-fields <list>", "comma-separated fields for fulltext index")
    .option("--fulltext-analyzer <name>", "fulltext analyzer")
    .option("--execute-type <type>", "batch execution type: incremental | full")
    .option("--wait", "poll until the build reaches a terminal state")
    .option("--timeout <s>", "wait timeout in seconds", (v) => Number.parseInt(v, 10), 300)
    .action(async (resourceId: string, _opts, cmd: Command) => {
      const o = cmd.optsWithGlobals();
      const embeddingFields = csv(o.embeddingFields);
      const buildKeyFields = csv(o.buildKeyFields);
      const fulltextFields = csv(o.fulltextFields);
      if (
        embeddingFields ||
        buildKeyFields ||
        o.embeddingModel ||
        fulltextFields ||
        o.fulltextAnalyzer
      ) {
        await clientFrom(cmd).resource.configureIndex(resourceId, {
          embeddingFields,
          buildKeyFields,
          embeddingModel: o.embeddingModel,
          fulltextFields,
          fulltextAnalyzer: o.fulltextAnalyzer,
        });
      }
      const task = await clientFrom(cmd).vega.build(
        {
          resource_id: resourceId,
          mode: o.mode,
          execute_type: o.executeType,
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

  dataset
    .command("build-list")
    .description("List BuildTasks")
    .option("--limit <n>", "page size", int, DEFAULT_LIST_LIMIT)
    .option("--offset <n>", "page offset", int, 0)
    .option("--resource-id <id>", "filter by resource id")
    .option("--catalog-id <id>", "filter by catalog id")
    .option("--status <status>", "comma-separated statuses")
    .option("--active", "only running/init tasks")
    .option("--mode <mode>", "filter by mode: batch | streaming")
    .option("--order-by <field>", "default | created_at | updated_at | status | mode")
    .option("--order <dir>", "asc | desc")
    .action(async (opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).vega.buildTasks({
          limit: opts.limit,
          offset: opts.offset,
          resourceId: opts.resourceId,
          catalogId: opts.catalogId,
          status: opts.status,
          active: opts.active,
          mode: opts.mode,
          orderBy: opts.orderBy,
          order: opts.order,
        }),
        outputOptions(cmd),
      );
    });

  dataset
    .command("build-start <task-id>")
    .description("Start a BuildTask")
    .option("--reset", "restart from the beginning")
    .action(async (taskId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).vega.startBuildTask(taskId, { reset: opts.reset }),
        outputOptions(cmd),
      );
    });

  dataset
    .command("build-stop <task-id>")
    .description("Stop a BuildTask")
    .action(async (taskId: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).vega.stopBuildTask(taskId), outputOptions(cmd));
    });

  dataset
    .command("build-delete <ids...>")
    .description("Delete one or more BuildTasks")
    .option("--ignore-missing", "ignore missing task ids")
    .option("--delete-active-index", "delete active indexes too")
    .action(async (ids: string[], opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).vega.deleteBuildTasks(ids, {
          ignoreMissing: opts.ignoreMissing,
          deleteActiveIndex: opts.deleteActiveIndex,
        }),
        outputOptions(cmd),
      );
    });

  return group(vega, "AI DATA PLATFORM");
}
