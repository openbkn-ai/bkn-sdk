// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** `openbkn vega …` — Catalog reads + index BuildTask. */
import { Command } from "commander";
import {
  BuildTaskSort,
  BuildTaskStatus,
  type CatalogHealthCheckScheduleRequest,
  type RawQueryRequest,
  SortDirection,
} from "../api/vega.js";
import { group } from "../help/grouped-help.js";
import { DEFAULT_LIST_LIMIT } from "../types.js";
import { InputError } from "../utils/errors.js";
import { parseBigIntJSON } from "../utils/json-bigint.js";
import { printJson } from "../utils/output.js";
import { clientFrom, csv, outputOptions } from "./_shared.js";

const int = (v: string) => Number.parseInt(v, 10);
const bool = (value: string): boolean => {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new InputError("boolean value must be true or false");
};

const parseJsonObject = (value: string, flag: string): Record<string, unknown> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new InputError(`${flag} must be valid JSON`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new InputError(`${flag} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
};

const parseStringRecord = (value: string, flag: string): Record<string, string> => {
  const parsed = parseJsonObject(value, flag);
  if (Object.values(parsed).some((item) => typeof item !== "string")) {
    throw new InputError(`${flag} values must be strings`);
  }
  return parsed as Record<string, string>;
};

const healthCheckSchedule = (
  mode?: string,
  cronExpr?: string,
): CatalogHealthCheckScheduleRequest | undefined => {
  if (!mode) {
    if (cronExpr) throw new InputError("a health-check cron expression requires enabled mode");
    return undefined;
  }
  if (mode === "enabled") {
    if (!cronExpr) {
      throw new InputError("a health-check cron expression is required in enabled mode");
    }
    return { mode, cronExpr };
  }
  if (mode === "inherit" || mode === "disabled") {
    if (cronExpr) {
      throw new InputError("a health-check cron expression is only valid in enabled mode");
    }
    return { mode };
  }
  throw new InputError("health-check mode must be inherit, enabled, or disabled");
};

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

const buildTaskStatuses = (raw?: string): BuildTaskStatus[] | undefined => {
  if (raw === undefined) return undefined;
  const statuses = csv(raw);
  if (!statuses?.length) {
    throw new InputError("--status must include at least one build status");
  }
  return statuses.map((status) => {
    const parsed = BuildTaskStatus.safeParse(status);
    if (!parsed.success) {
      throw new InputError(
        `invalid build status "${status}"; expected one of ${BuildTaskStatus.options.join(", ")}`,
      );
    }
    return parsed.data;
  });
};

const buildTaskSort = (raw?: string): BuildTaskSort | undefined => {
  if (raw === undefined) return undefined;
  const parsed = BuildTaskSort.safeParse(raw);
  if (!parsed.success) {
    throw new InputError(
      `invalid build task sort "${raw}"; expected one of ${BuildTaskSort.options.join(", ")}`,
    );
  }
  return parsed.data;
};

const sortDirection = (raw?: string): SortDirection | undefined => {
  if (raw === undefined) return undefined;
  const parsed = SortDirection.safeParse(raw);
  if (!parsed.success) {
    throw new InputError(
      `invalid sort direction "${raw}"; expected one of ${SortDirection.options.join(", ")}`,
    );
  }
  return parsed.data;
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
    .command("health <id>")
    .description("Health-status for a catalog")
    .action(async (id: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).vega.catalogHealth(id), outputOptions(cmd));
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
    .option("--allow-unhealthy", "save the catalog when its connection test fails")
    .option("--health-check-mode <mode>", "health schedule: inherit | enabled | disabled")
    .option("--health-check-cron <expr>", "cron expression for enabled health checks")
    .action(async (opts, cmd: Command) => {
      const connectorConfig = parseJsonObject(opts.connectorConfig, "--connector-config");
      const extensions = opts.extensions
        ? parseStringRecord(opts.extensions, "--extensions")
        : undefined;
      printJson(
        await clientFrom(cmd).vega.createCatalog(
          {
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
            healthCheckSchedule: healthCheckSchedule(opts.healthCheckMode, opts.healthCheckCron),
          },
          { allowUnhealthy: opts.allowUnhealthy ? true : undefined },
        ),
        outputOptions(cmd),
      );
    });
  catalog
    .command("update <id>")
    .description("Fully update a catalog")
    .requiredOption("--name <s>", "catalog name")
    .requiredOption("--connector-type <s>", "connector type")
    .requiredOption("--enabled <bool>", "current enabled state", bool)
    .option("--connector-config <json>", "connector config JSON")
    .option("--tags <t1,t2>", "comma-separated tags")
    .option("--description <s>", "description")
    .option("--extensions <json>", "extension key/value JSON object")
    .option("--allow-unhealthy", "save the update when its connection test fails")
    .action(async (id: string, opts, cmd: Command) => {
      const connectorConfig = opts.connectorConfig
        ? parseJsonObject(opts.connectorConfig, "--connector-config")
        : undefined;
      const extensions = opts.extensions
        ? parseStringRecord(opts.extensions, "--extensions")
        : undefined;
      printJson(
        await clientFrom(cmd).vega.updateCatalog(
          id,
          {
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
            enabled: opts.enabled,
            extensions,
          },
          { allowUnhealthy: opts.allowUnhealthy ? true : undefined },
        ),
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
    .option("--dry-run", "preview deletion impact without changing data")
    .action(async (id: string, opts, cmd: Command) => {
      const result = opts.dryRun
        ? await clientFrom(cmd).vega.deleteCatalog(id, { dryRun: true })
        : await clientFrom(cmd).vega.deleteCatalog(id);
      printJson(result, outputOptions(cmd));
    });
  catalog
    .command("test-connection <id>")
    .description("Test a catalog connection")
    .action(async (id: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).vega.testCatalogConnection(id), outputOptions(cmd));
    });
  catalog
    .command("test-connection-config")
    .description("Test an unpersisted catalog connection configuration")
    .requiredOption("--connector-type <s>", "connector type")
    .requiredOption("--connector-config <json>", "connector config JSON")
    .action(async (opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).vega.testCatalogConnectionConfig({
          connectorType: opts.connectorType,
          connectorConfig: parseJsonObject(opts.connectorConfig, "--connector-config"),
        }),
        outputOptions(cmd),
      );
    });
  catalog
    .command("health-check-schedule <id>")
    .description("Get a catalog health-check schedule")
    .action(async (id: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).vega.catalogHealthCheckSchedule(id), outputOptions(cmd));
    });
  catalog
    .command("set-health-check-schedule <id>")
    .description("Update a catalog health-check schedule")
    .requiredOption("--mode <mode>", "health schedule: inherit | enabled | disabled")
    .option("--cron <expr>", "cron expression for enabled health checks")
    .action(async (id: string, opts, cmd: Command) => {
      const schedule = healthCheckSchedule(opts.mode, opts.cron);
      if (!schedule) throw new InputError("--mode is required");
      printJson(
        await clientFrom(cmd).vega.updateCatalogHealthCheckSchedule(id, schedule),
        outputOptions(cmd),
      );
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
      "--query <sql>",
      "SQL string; reference a resource with a {{<resource-id>}} placeholder",
    )
    .option("--input-dialect <dialect>", "SQL input dialect: postgres | mysql | trino | duckdb")
    .option("--paging-mode <mode>", "paging mode: single | cursor")
    .option("--limit <n>", "page size (cursor mode requires it)", int)
    .option("--offset <n>", "first-page offset", int)
    .option("--keep-alive-sec <s>", "cursor keep-alive in seconds (60–3600)", int)
    .option("--cursor <cursor>", "opaque cursor returned by the previous page")
    .option("--need-total", "include the complete total count")
    .option("--query-timeout-sec <s>", "query timeout in seconds (1–3600)", int)
    .option(
      "-d, --data <json>",
      "full request body as JSON (advanced; wins over individual query flags)",
    )
    .action(async (opts, cmd: Command) => {
      let body: RawQueryRequest;
      if (opts.data) {
        try {
          body = parseBigIntJSON(opts.data) as RawQueryRequest;
        } catch {
          throw new InputError("--data must be valid JSON");
        }
      } else if (opts.cursor) {
        if (
          opts.query ||
          opts.inputDialect ||
          opts.pagingMode ||
          opts.limit !== undefined ||
          opts.offset !== undefined ||
          opts.keepAliveSec !== undefined ||
          opts.queryTimeoutSec !== undefined
        ) {
          throw new InputError("--cursor cannot be combined with initial-query options");
        }
        body = {
          paging: { cursor: opts.cursor },
          ...(opts.needTotal ? { need_total: true } : {}),
        };
      } else {
        if (!opts.query) {
          throw new InputError("Provide --query, --cursor, or --data.");
        }
        if (opts.pagingMode === "cursor" && opts.limit === undefined) {
          throw new InputError("--limit is required when --paging-mode cursor");
        }
        const paging = {
          ...(opts.pagingMode ? { mode: opts.pagingMode } : {}),
          ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
          ...(opts.offset !== undefined ? { offset: opts.offset } : {}),
          ...(opts.keepAliveSec !== undefined ? { keep_alive_sec: opts.keepAliveSec } : {}),
        };
        body = {
          query: opts.query,
          query_format: "sql",
          ...(opts.inputDialect ? { input_dialect: opts.inputDialect } : {}),
          ...(Object.keys(paging).length ? { paging } : {}),
          ...(opts.needTotal ? { need_total: true } : {}),
          ...(opts.queryTimeoutSec !== undefined
            ? { query_timeout_sec: opts.queryTimeoutSec }
            : {}),
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
    .option("--embedding-model <id>", "small-model ID for the vector index")
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
    .command("build-status <task-id>")
    .description("Show a BuildTask's state and progress")
    .action(async (taskId: string, _opts, cmd: Command) => {
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
    .option("--status <status>", `comma-separated statuses: ${BuildTaskStatus.options.join(" | ")}`)
    .option("--mode <mode>", "filter by mode: batch | streaming")
    .option("--sort <field>", `sort field: ${BuildTaskSort.options.join(" | ")}`)
    .option("--direction <dir>", `sort direction: ${SortDirection.options.join(" | ")}`)
    .action(async (opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).vega.buildTasks({
          limit: opts.limit,
          offset: opts.offset,
          resourceId: opts.resourceId,
          catalogId: opts.catalogId,
          status: buildTaskStatuses(opts.status),
          mode: opts.mode,
          sort: buildTaskSort(opts.sort),
          direction: sortDirection(opts.direction),
        }),
        outputOptions(cmd),
      );
    });

  dataset
    .command("build-start <task-id>")
    .description("Start a BuildTask")
    .option("--reset", "restart a full task from the beginning (ignored for incremental tasks)")
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
