// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** `openbkn vega …` — Catalog reads + index BuildTask. */
import { Command } from "commander";
import {
  DiscoverScheduleSort,
  DiscoverStrategy,
  DiscoverTaskSort,
  DiscoverTaskTriggerType,
  VegaTaskStatus,
} from "../api/vega-discovery.js";
import {
  SemanticUnderstandingApplyMode,
  SemanticUnderstandingScope,
  SemanticUnderstandingTaskSort,
} from "../api/vega-semantic.js";
import {
  BuildTaskExecuteType,
  BuildTaskSort,
  BuildTaskStatus,
  type CatalogHealthCheckScheduleConfig,
  type RawQueryRequest,
  SortDirection,
} from "../api/vega.js";
import { group, groupChildren, guide } from "../help/grouped-help.js";
import { DEFAULT_LIST_LIMIT } from "../types.js";
import { InputError } from "../utils/errors.js";
import { parseBigIntJSON } from "../utils/json-bigint.js";
import { printJson } from "../utils/output.js";
import { clientFrom, csv, outputOptions } from "./_shared.js";

const int = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new InputError(`expected an integer, received "${value}"`);
  }
  return parsed;
};
const expectedUpdateTime = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new InputError("--expected-update-time must be a positive integer timestamp");
  }
  return parsed;
};
const confidenceThreshold = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new InputError("--confidence-threshold must be a number between 0 and 1");
  }
  return parsed;
};
const bool = (value: string): boolean => {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new InputError("boolean value must be true or false");
};

const parseJsonObject = (value: string, flag: string): Record<string, unknown> => {
  let parsed: unknown;
  try {
    parsed = parseBigIntJSON(value);
  } catch {
    throw new InputError(`${flag} must be valid JSON`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new InputError(`${flag} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
};

const parseJsonArray = (value: string, flag: string): Record<string, unknown>[] => {
  let parsed: unknown;
  try {
    parsed = parseBigIntJSON(value);
  } catch {
    throw new InputError(`${flag} must be valid JSON`);
  }
  if (
    !Array.isArray(parsed) ||
    parsed.some((item) => typeof item !== "object" || item === null || Array.isArray(item))
  ) {
    throw new InputError(`${flag} must be a JSON array of objects`);
  }
  return parsed as Record<string, unknown>[];
};

const healthCheckSchedule = (
  mode?: string,
  cronExpr?: string,
): CatalogHealthCheckScheduleConfig | undefined => {
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

const buildTaskExecuteType = (raw?: string): BuildTaskExecuteType | undefined => {
  if (raw === undefined) return undefined;
  const parsed = BuildTaskExecuteType.safeParse(raw);
  if (!parsed.success) {
    throw new InputError(
      `invalid build task execute type "${raw}"; expected one of ${BuildTaskExecuteType.options.join(", ")}`,
    );
  }
  return parsed.data;
};

const discoverStrategy = (raw?: string): DiscoverStrategy | undefined => {
  if (raw === undefined) return undefined;
  const parsed = DiscoverStrategy.safeParse(raw);
  if (!parsed.success) {
    throw new InputError(
      `invalid discover strategy "${raw}"; expected one of ${DiscoverStrategy.options.join(", ")}`,
    );
  }
  return parsed.data;
};

const requiredDiscoverStrategy = (raw: string): DiscoverStrategy =>
  discoverStrategy(raw) as DiscoverStrategy;

const taskStatuses = (raw?: string): VegaTaskStatus[] | undefined => {
  if (raw === undefined) return undefined;
  const values = csv(raw);
  if (!values?.length) throw new InputError("--status must include at least one task status");
  return values.map((value) => {
    const parsed = VegaTaskStatus.safeParse(value);
    if (!parsed.success) {
      throw new InputError(
        `invalid task status "${value}"; expected one of ${VegaTaskStatus.options.join(", ")}`,
      );
    }
    return parsed.data;
  });
};

const semanticScope = (raw?: string): SemanticUnderstandingScope | undefined => {
  if (raw === undefined) return undefined;
  const parsed = SemanticUnderstandingScope.safeParse(raw);
  if (!parsed.success) {
    throw new InputError(
      `invalid semantic task scope "${raw}"; expected one of ${SemanticUnderstandingScope.options.join(", ")}`,
    );
  }
  return parsed.data;
};

const semanticApplyMode = (raw?: string): SemanticUnderstandingApplyMode | undefined => {
  if (raw === undefined) return undefined;
  const parsed = SemanticUnderstandingApplyMode.safeParse(raw);
  if (!parsed.success) {
    throw new InputError(
      `invalid semantic apply mode "${raw}"; expected one of ${SemanticUnderstandingApplyMode.options.join(", ")}`,
    );
  }
  return parsed.data;
};

const discoverScheduleSort = (raw?: string): DiscoverScheduleSort | undefined => {
  if (raw === undefined) return undefined;
  const parsed = DiscoverScheduleSort.safeParse(raw);
  if (!parsed.success) {
    throw new InputError(
      `invalid discover schedule sort "${raw}"; expected one of ${DiscoverScheduleSort.options.join(", ")}`,
    );
  }
  return parsed.data;
};

const discoverTaskSort = (raw?: string): DiscoverTaskSort | undefined => {
  if (raw === undefined) return undefined;
  const parsed = DiscoverTaskSort.safeParse(raw);
  if (!parsed.success) {
    throw new InputError(
      `invalid discover task sort "${raw}"; expected one of ${DiscoverTaskSort.options.join(", ")}`,
    );
  }
  return parsed.data;
};

const discoverTaskTriggerType = (raw?: string): DiscoverTaskTriggerType | undefined => {
  if (raw === undefined) return undefined;
  const parsed = DiscoverTaskTriggerType.safeParse(raw);
  if (!parsed.success) {
    throw new InputError(
      `invalid discover task trigger type "${raw}"; expected one of ${DiscoverTaskTriggerType.options.join(", ")}`,
    );
  }
  return parsed.data;
};

const semanticTaskSort = (raw?: string): SemanticUnderstandingTaskSort | undefined => {
  if (raw === undefined) return undefined;
  const parsed = SemanticUnderstandingTaskSort.safeParse(raw);
  if (!parsed.success) {
    throw new InputError(
      `invalid semantic task sort "${raw}"; expected one of ${SemanticUnderstandingTaskSort.options.join(", ")}`,
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
    "Data sources: catalogs, connectors, SQL, index builds",
  );

  const catalog = vega.command("catalog").description("Catalog entries");
  catalog
    .command("list")
    .description("List catalog entries")
    .option("--limit <n>", "page size", int, DEFAULT_LIST_LIMIT)
    .option("--offset <n>", "page offset", int, 0)
    .option("--name <s>", "filter by name")
    .option("--tag <s>", "filter by tag")
    .option("--type <type>", "filter by catalog type: physical | logical")
    .option("--connector-type <type>", "filter by connector type")
    .option("--enabled <bool>", "filter by enabled state")
    .option("--health-check-status <s>", "filter by health status")
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
        connectorType: o.connectorType,
        enabled: o.enabled === undefined ? undefined : o.enabled === "true",
        healthCheckStatus: o.healthCheckStatus,
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
    .option("--limit <n>", "page size (default 30, max 1000; -1 = all)", int)
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
    .option("--allow-unhealthy", "save the catalog when its connection test fails")
    .option("--health-check-mode <mode>", "health schedule: inherit | enabled | disabled")
    .option("--health-check-cron <expr>", "cron expression for enabled health checks")
    .action(async (opts, cmd: Command) => {
      const connectorConfig = parseJsonObject(opts.connectorConfig, "--connector-config");
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
    .requiredOption(
      "--expected-update-time <ms>",
      "optimistic-lock update time",
      expectedUpdateTime,
    )
    .option("--allow-unhealthy", "save the update when its connection test fails")
    .action(async (id: string, opts, cmd: Command) => {
      const connectorConfig = opts.connectorConfig
        ? parseJsonObject(opts.connectorConfig, "--connector-config")
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
            expectedUpdateTime: opts.expectedUpdateTime,
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
    .requiredOption(
      "--expected-update-time <ms>",
      "optimistic-lock update time",
      expectedUpdateTime,
    )
    .action(async (id: string, opts, cmd: Command) => {
      const schedule = healthCheckSchedule(opts.mode, opts.cron);
      if (!schedule) throw new InputError("--mode is required");
      printJson(
        await clientFrom(cmd).vega.updateCatalogHealthCheckSchedule(id, {
          ...schedule,
          expectedUpdateTime: opts.expectedUpdateTime,
        }),
        outputOptions(cmd),
      );
    });
  catalog
    .command("discover <id>")
    .description("Trigger catalog resource discovery")
    .option("--strategy <strategy>", `strategy: ${DiscoverStrategy.options.join(" | ")}`)
    .action(async (id: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).vega.discoverCatalog(id, {
          strategy: discoverStrategy(opts.strategy),
        }),
        outputOptions(cmd),
      );
    });

  const discoverSchedule = vega
    .command("discover-schedule")
    .description("Resource discovery schedules");
  discoverSchedule
    .command("list")
    .description("List discovery schedules")
    .option("--name <s>", "filter by name")
    .option("--catalog-id <id>", "filter by catalog id")
    .option("--enabled <bool>", "filter by enabled state", bool)
    .option("--limit <n>", "page size", int, DEFAULT_LIST_LIMIT)
    .option("--offset <n>", "page offset", int, 0)
    .option("--sort <field>", "name | create_time | update_time | next_run")
    .option("--direction <dir>", "asc | desc")
    .action(async (opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).vega.discoverSchedules({
          name: opts.name,
          catalogId: opts.catalogId,
          enabled: opts.enabled,
          limit: opts.limit,
          offset: opts.offset,
          sort: discoverScheduleSort(opts.sort),
          direction: sortDirection(opts.direction),
        }),
        outputOptions(cmd),
      );
    });
  discoverSchedule
    .command("get <id>")
    .description("Get a discovery schedule")
    .action(async (id: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).vega.getDiscoverSchedule(id), outputOptions(cmd));
    });
  discoverSchedule
    .command("create")
    .description("Create a discovery schedule")
    .requiredOption("--name <s>", "schedule name")
    .requiredOption("--catalog-id <id>", "catalog id")
    .requiredOption("--cron <expr>", "five-field cron expression")
    .option("--start-time <ms>", "start time", int)
    .option("--end-time <ms>", "end time", int)
    .option("--enabled", "create enabled")
    .option("--strategy <strategy>", `strategy: ${DiscoverStrategy.options.join(" | ")}`)
    .action(async (opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).vega.createDiscoverSchedule({
          name: opts.name,
          catalogId: opts.catalogId,
          cronExpr: opts.cron,
          startTime: opts.startTime,
          endTime: opts.endTime,
          enabled: opts.enabled ? true : undefined,
          strategy: discoverStrategy(opts.strategy),
        }),
        outputOptions(cmd),
      );
    });
  discoverSchedule
    .command("update <id>")
    .description("Fully update a discovery schedule")
    .requiredOption("--name <s>", "schedule name")
    .requiredOption("--catalog-id <id>", "current catalog id")
    .requiredOption("--cron <expr>", "five-field cron expression")
    .requiredOption("--enabled <bool>", "current enabled state", bool)
    .requiredOption("--start-time <ms>", "start time (0 = no lower bound)", int)
    .requiredOption("--end-time <ms>", "end time (0 = no upper bound)", int)
    .requiredOption("--strategy <strategy>", `strategy: ${DiscoverStrategy.options.join(" | ")}`)
    .requiredOption(
      "--expected-update-time <ms>",
      "optimistic-lock update time",
      expectedUpdateTime,
    )
    .action(async (id: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).vega.updateDiscoverSchedule(id, {
          name: opts.name,
          catalogId: opts.catalogId,
          cronExpr: opts.cron,
          enabled: opts.enabled,
          startTime: opts.startTime,
          endTime: opts.endTime,
          strategy: requiredDiscoverStrategy(opts.strategy),
          expectedUpdateTime: opts.expectedUpdateTime,
        }),
        outputOptions(cmd),
      );
    });
  for (const action of ["enable", "disable", "delete"] as const) {
    discoverSchedule
      .command(`${action} <id>`)
      .description(`${action[0]?.toUpperCase()}${action.slice(1)} a discovery schedule`)
      .action(async (id: string, _opts, cmd: Command) => {
        const api = clientFrom(cmd).vega;
        const result =
          action === "enable"
            ? await api.enableDiscoverSchedule(id)
            : action === "disable"
              ? await api.disableDiscoverSchedule(id)
              : await api.deleteDiscoverSchedule(id);
        printJson(result, outputOptions(cmd));
      });
  }

  const discoverTask = vega.command("discover-task").description("Resource discovery tasks");
  discoverTask
    .command("list")
    .description("List discovery tasks")
    .option("--catalog-id <id>", "filter by catalog id")
    .option("--resource-id <id>", "filter by resource id")
    .option("--schedule-id <id>", "filter by schedule id")
    .option("--status <status>", `comma-separated: ${VegaTaskStatus.options.join(" | ")}`)
    .option("--strategy <strategy>", `strategy: ${DiscoverStrategy.options.join(" | ")}`)
    .option("--trigger-type <type>", "manual | scheduled")
    .option("--limit <n>", "page size", int, DEFAULT_LIST_LIMIT)
    .option("--offset <n>", "page offset", int, 0)
    .option("--sort <field>", "create_time | start_time | finish_time | last_progress_time")
    .option("--direction <dir>", "asc | desc")
    .action(async (opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).vega.discoverTasks({
          catalogId: opts.catalogId,
          resourceId: opts.resourceId,
          scheduleId: opts.scheduleId,
          status: taskStatuses(opts.status),
          strategy: discoverStrategy(opts.strategy),
          triggerType: discoverTaskTriggerType(opts.triggerType),
          limit: opts.limit,
          offset: opts.offset,
          sort: discoverTaskSort(opts.sort),
          direction: sortDirection(opts.direction),
        }),
        outputOptions(cmd),
      );
    });
  discoverTask
    .command("get <id>")
    .description("Get a discovery task")
    .action(async (id: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).vega.getDiscoverTask(id), outputOptions(cmd));
    });
  discoverTask
    .command("delete <ids...>")
    .description("Delete completed discovery tasks")
    .option("--ignore-missing", "ignore missing task ids")
    .action(async (ids: string[], opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).vega.deleteDiscoverTasks(ids, {
          ignoreMissing: opts.ignoreMissing,
        }),
        outputOptions(cmd),
      );
    });

  const semanticTask = vega.command("semantic-task").description("Semantic-understanding tasks");
  semanticTask
    .command("list")
    .description("List semantic-understanding tasks")
    .option("--scope <scope>", `scope: ${SemanticUnderstandingScope.options.join(" | ")}`)
    .option("--catalog-id <id>", "filter by catalog id")
    .option("--resource-id <id>", "filter by resource id")
    .option("--status <status>", `comma-separated: ${VegaTaskStatus.options.join(" | ")}`)
    .option(
      "--apply-mode <mode>",
      `apply mode: ${SemanticUnderstandingApplyMode.options.join(" | ")}`,
    )
    .option("--applied <bool>", "filter by applied state", bool)
    .option("--limit <n>", "page size", int, DEFAULT_LIST_LIMIT)
    .option("--offset <n>", "page offset", int, 0)
    .option("--sort <field>", "create_time | start_time | finish_time")
    .option("--direction <dir>", "asc | desc")
    .action(async (opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).vega.semanticUnderstandingTasks({
          scope: semanticScope(opts.scope),
          catalogId: opts.catalogId,
          resourceId: opts.resourceId,
          status: taskStatuses(opts.status),
          applyMode: semanticApplyMode(opts.applyMode),
          applied: opts.applied,
          limit: opts.limit,
          offset: opts.offset,
          sort: semanticTaskSort(opts.sort),
          direction: sortDirection(opts.direction),
        }),
        outputOptions(cmd),
      );
    });
  semanticTask
    .command("create")
    .description("Create a semantic-understanding task")
    .requiredOption("--scope <scope>", "resource | catalog")
    .option("--catalog-id <id>", "catalog id")
    .option("--resource-id <id>", "resource id")
    .option("--apply-mode <mode>", "dry_run | fill_empty | force")
    .option("--confidence-threshold <n>", "minimum confidence (0..1)", confidenceThreshold)
    .option("--include-sample-rows", "include resource sample rows")
    .option("--sample-max-rows <n>", "sample row limit", int)
    .action(async (opts, cmd: Command) => {
      const scope = semanticScope(opts.scope);
      if (!scope) throw new InputError("--scope is required");
      const applyMode = semanticApplyMode(opts.applyMode);
      if (scope === "catalog" && !opts.catalogId) {
        throw new InputError("--catalog-id is required for catalog scope");
      }
      if (scope === "resource" && !opts.resourceId) {
        throw new InputError("--resource-id is required for resource scope");
      }
      if (scope === "catalog" && (opts.includeSampleRows || opts.sampleMaxRows !== undefined)) {
        throw new InputError("sample row options are only valid for resource scope");
      }
      if (scope === "resource" && opts.includeSampleRows && opts.sampleMaxRows === undefined) {
        throw new InputError("--sample-max-rows is required with --include-sample-rows");
      }
      if (scope === "resource" && !opts.includeSampleRows && opts.sampleMaxRows !== undefined) {
        throw new InputError("--sample-max-rows requires --include-sample-rows");
      }
      if (opts.sampleMaxRows !== undefined && (opts.sampleMaxRows < 1 || opts.sampleMaxRows > 20)) {
        throw new InputError("--sample-max-rows must be between 1 and 20");
      }
      const common = {
        applyMode,
        confidenceThreshold: opts.confidenceThreshold,
      };
      const request =
        scope === "catalog"
          ? { scope: "catalog" as const, catalogId: opts.catalogId, ...common }
          : {
              scope: "resource" as const,
              resourceId: opts.resourceId,
              includeSampleRows: opts.includeSampleRows ? true : undefined,
              samplePolicy:
                opts.sampleMaxRows === undefined
                  ? undefined
                  : { masked: false as const, maxRows: opts.sampleMaxRows },
              ...common,
            };
      printJson(
        await clientFrom(cmd).vega.createSemanticUnderstandingTask(request),
        outputOptions(cmd),
      );
    });
  semanticTask
    .command("get <id>")
    .description("Get a semantic-understanding task")
    .action(async (id: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).vega.getSemanticUnderstandingTask(id), outputOptions(cmd));
    });
  semanticTask
    .command("delete <ids...>")
    .description("Delete completed semantic-understanding tasks")
    .option("--ignore-missing", "ignore missing task ids")
    .action(async (ids: string[], opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).vega.deleteSemanticUnderstandingTasks(ids, {
          ignoreMissing: opts.ignoreMissing,
        }),
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
    .description(
      "Read-only SQL straight against a data source — no knowledge network, no Trace record",
    )
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
    .option("--catalog-id <id>", "filter by catalog id")
    .option("--type <category>", "resource category")
    .option("--category <category>", "alias of --type")
    .option("--status <status>", "filter by status")
    .option("--schema <name>", "filter by source schema")
    .option("--limit <n>", "page size", int, DEFAULT_LIST_LIMIT)
    .option("--offset <n>", "page offset", int, 0)
    .option("--sort <field>", "sort field: name | create_time | update_time")
    .option("--direction <dir>", "sort direction: asc | desc")
    .action(async (opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).resource.list({
          catalogId: opts.catalogId,
          category: opts.type ?? opts.category,
          status: opts.status,
          schema: opts.schema,
          limit: opts.limit,
          offset: opts.offset,
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
    .command("discover <id>")
    .description("Trigger metadata discovery for a resource")
    .action(async (id: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).vega.discoverResource(id), outputOptions(cmd));
    });
  for (const action of ["enable", "disable"] as const) {
    resource
      .command(`${action} <id>`)
      .description(`${action[0]?.toUpperCase()}${action.slice(1)} a resource`)
      .action(async (id: string, _opts, cmd: Command) => {
        const api = clientFrom(cmd).resource;
        const result = action === "enable" ? await api.enable(id) : await api.disable(id);
        printJson(result, outputOptions(cmd));
      });
  }
  resource
    .command("query <id>")
    .description("Fetch data rows from a resource")
    .option("--limit <n>", "row limit", int, 50)
    .option("--offset <n>", "row offset", int, 0)
    .action(async (id: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).resource.query(id, { limit: opts.limit, offset: opts.offset }),
        outputOptions(cmd),
      );
    });
  resource
    .command("document-get <resource-id> <document-id>")
    .description("Get one dataset document")
    .action(async (resourceId: string, documentId: string, _opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).resource.getDocument(resourceId, documentId),
        outputOptions(cmd),
      );
    });
  resource
    .command("document-create <resource-id>")
    .description("Create dataset documents")
    .requiredOption(
      "--data <json>",
      "JSON array of documents — docs: https://openbkn-ai.github.io/bkn-foundry/ (vega-backend)",
    )
    .action(async (resourceId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).resource.createDocuments(
          resourceId,
          parseJsonArray(opts.data, "--data"),
        ),
        outputOptions(cmd),
      );
    });
  resource
    .command("document-upsert <resource-id>")
    .description("Upsert dataset documents; every document must have an id")
    .requiredOption(
      "--data <json>",
      "JSON array of documents — docs: https://openbkn-ai.github.io/bkn-foundry/ (vega-backend)",
    )
    .action(async (resourceId: string, opts, cmd: Command) => {
      const documents = parseJsonArray(opts.data, "--data");
      if (documents.some((document) => typeof document.id !== "string")) {
        throw new InputError("every document in --data must have a string id");
      }
      printJson(
        await clientFrom(cmd).resource.upsertDocuments(resourceId, documents as never),
        outputOptions(cmd),
      );
    });
  resource
    .command("document-delete <resource-id> <document-ids...>")
    .description("Delete dataset documents by id")
    .action(async (resourceId: string, documentIds: string[], _opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).resource.deleteDocuments(resourceId, documentIds),
        outputOptions(cmd),
      );
    });
  resource
    .command("document-delete-filter <resource-id>")
    .description("Delete dataset documents by a non-empty filter")
    .requiredOption("--filter <json>", "filter_condition JSON object")
    .action(async (resourceId: string, opts, cmd: Command) => {
      const filter = parseJsonObject(opts.filter, "--filter");
      if (!Object.keys(filter).length) throw new InputError("--filter must not be empty");
      printJson(
        await clientFrom(cmd).resource.deleteDocumentsByFilter(resourceId, filter),
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
    .option(
      "--embedding-model <name-or-id>",
      "default small-model name (a numeric ID is resolved to its name)",
    )
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
    .option(
      "--execute-type <type>",
      `filter by execution type: ${BuildTaskExecuteType.options.join(" | ")}`,
    )
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
          executeType: buildTaskExecuteType(opts.executeType),
          sort: buildTaskSort(opts.sort),
          direction: sortDirection(opts.direction),
        }),
        outputOptions(cmd),
      );
    });

  dataset
    .command("build-start <task-id>")
    .description("Start a BuildTask")
    .option("--reset", "restart a full task from the beginning (rejected for incremental tasks)")
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
    .action(async (ids: string[], opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).vega.deleteBuildTasks(ids, {
          ignoreMissing: opts.ignoreMissing,
        }),
        outputOptions(cmd),
      );
    });

  groupChildren(vega, {
    GROUPS: [
      "catalog",
      "resource",
      "connector-type",
      "dataset",
      "discover-schedule",
      "discover-task",
      "semantic-task",
    ],
    RUN: ["sql"],
  });

  groupChildren(resource, {
    READ: ["list", "get", "document-get"],
    RUN: ["query", "discover"],
    WRITE: [
      "enable",
      "disable",
      "document-create",
      "document-upsert",
      "document-delete",
      "document-delete-filter",
    ],
  });

  groupChildren(catalog, {
    READ: ["list", "get", "resources", "health", "health-check-schedule"],
    RUN: ["test-connection", "test-connection-config", "discover"],
    WRITE: ["create", "update", "enable", "disable", "delete", "set-health-check-schedule"],
  });

  guide(
    vega,
    `FINDING DATA
  catalog list -> catalog resources <catalog-id> -> resource get <id>. A physical catalog
  can be discovered and written; a logical one cannot.

QUERYING DIRECTLY
  sql --query "<sql>" runs against the source itself. Name a resource with a
  {{<resource-id>}} placeholder rather than the physical table it happens to have.

BUILDING AN INDEX
  dataset build <resource-id> creates a BuildTask; build-status / build-list follow it.
  Indexes are per resource — a knowledge network has no build of its own.`,
  );
  return group(vega, "DATA & KNOWLEDGE");
}
