// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** `openbkn bkn …` — knowledge networks. */
import { Command } from "commander";
import { group } from "../help/grouped-help.js";
import { DEFAULT_LIST_LIMIT } from "../types.js";
import { validateBknDirectory } from "../utils/bkn-validate.js";
import { printJson } from "../utils/output.js";
import { parseEmbeddingFields, parsePkMap } from "../utils/pk-detection.js";
import { clientFrom, csv, outputOptions, readBody } from "./_shared.js";

const int = (v: string) => Number.parseInt(v, 10);

export function bknCommand(): Command {
  const bkn = new Command("bkn").description("Knowledge networks — list, query, schema, instances");

  bkn
    .command("list")
    .description("List knowledge networks")
    .option("--limit <n>", "page size", int, DEFAULT_LIST_LIMIT)
    .option("--offset <n>", "page offset", int, 0)
    .option("--name-pattern <s>", "filter by name pattern")
    .option("--tag <s>", "filter by tag")
    .option("--sort <field>", "sort field", "update_time")
    .option("--direction <dir>", "asc | desc", "desc")
    .action(async (_opts, cmd: Command) => {
      const o = cmd.optsWithGlobals();
      const data = await clientFrom(cmd).kn.list({
        limit: o.limit,
        offset: o.offset,
        namePattern: o.namePattern,
        tag: o.tag,
        sort: o.sort,
        direction: o.direction,
      });
      printJson(data, outputOptions(cmd));
    });

  bkn
    .command("get <kn-id>")
    .description("Get a knowledge network (use --stats or --export)")
    .option("--stats", "include statistics")
    .option("--export", "return the full export payload")
    .action(async (knId: string, opts, cmd: Command) => {
      const data = await clientFrom(cmd).kn.get(knId, {
        stats: opts.stats,
        exportMode: opts.export,
      });
      printJson(data, outputOptions(cmd));
    });

  bkn
    .command("search <kn-id> <query>")
    .description("Semantic search within a knowledge network")
    .option("--max-concepts <n>", "max concepts to return", int, 10)
    .option("--mode <mode>", "retrieval mode", "keyword_vector_retrieval")
    .action(async (knId: string, query: string, opts, cmd: Command) => {
      const data = await clientFrom(cmd).kn.search(knId, query, {
        maxConcepts: opts.maxConcepts,
        mode: opts.mode,
      });
      printJson(data, outputOptions(cmd));
    });

  // Schema groups: real list; object-type/relation-type also get real CRUD.
  const schemaGroups: Array<
    [string, "objectTypes" | "relationTypes" | "actionTypes", "objectType" | "relationType" | null]
  > = [
    ["object-type", "objectTypes", "objectType"],
    ["relation-type", "relationTypes", "relationType"],
    ["action-type", "actionTypes", null],
  ];
  for (const [name, listMethod, crud] of schemaGroups) {
    const g = bkn.command(name).description(`${name} list/get/...`);
    g.command("list <kn-id>")
      .description(`List ${name}s`)
      .option("--branch <b>", "branch", "main")
      .action(async (knId: string, opts, cmd: Command) => {
        printJson(
          await clientFrom(cmd).kn[listMethod](knId, { branch: opts.branch }),
          outputOptions(cmd),
        );
      });
    if (crud) {
      g.command("get <kn-id> <id>")
        .description(`Get ${name}`)
        .action(async (knId: string, id: string, _o, cmd: Command) => {
          printJson(await clientFrom(cmd).kn[`${crud}Get`](knId, id), outputOptions(cmd));
        });
      g.command("create <kn-id>")
        .description(`Create ${name} (--body / --body-file)`)
        .option("--body <json>", "body JSON")
        .option("--body-file <path>", "read body JSON from a file")
        .action(async (knId: string, opts, cmd: Command) => {
          printJson(
            await clientFrom(cmd).kn[`${crud}Create`](knId, readBody(opts)),
            outputOptions(cmd),
          );
        });
      g.command("update <kn-id> <id>")
        .description(`Update ${name} (--body / --body-file)`)
        .option("--body <json>", "body JSON")
        .option("--body-file <path>", "read body JSON from a file")
        .action(async (knId: string, id: string, opts, cmd: Command) => {
          printJson(
            await clientFrom(cmd).kn[`${crud}Update`](knId, id, readBody(opts)),
            outputOptions(cmd),
          );
        });
      g.command("delete <kn-id> <id>")
        .description(`Delete ${name}`)
        .option("-y, --yes", "skip confirmation")
        .action(async (knId: string, id: string, _o, cmd: Command) => {
          printJson(await clientFrom(cmd).kn[`${crud}Delete`](knId, id), outputOptions(cmd));
        });
    }
  }

  // Real action-type query + execute on the action-type group.
  const actionType = bkn.commands.find((c) => c.name() === "action-type");
  actionType
    ?.command("query <kn-id> <at-id>")
    .description("Query an action type (--body / --body-file JSON)")
    .option("--body <json>", "query JSON")
    .option("--body-file <path>", "read query JSON from a file")
    .action(async (knId: string, atId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).kn.actionTypeQuery(knId, atId, readBody(opts)),
        outputOptions(cmd),
      );
    });
  actionType
    ?.command("execute <kn-id> <at-id>")
    .description("Execute an action type (--body / --body-file envelope JSON)")
    .option("--body <json>", "execution envelope JSON")
    .option("--body-file <path>", "read envelope JSON from a file")
    .action(async (knId: string, atId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).kn.actionTypeExecute(knId, atId, readBody(opts)),
        outputOptions(cmd),
      );
    });
  actionType
    ?.command("inputs <kn-id> <at-id>")
    .description("Get an action type's input schema")
    .action(async (knId: string, atId: string, _o, cmd: Command) => {
      printJson(await clientFrom(cmd).kn.actionTypeInputs(knId, atId), outputOptions(cmd));
    });
  actionType
    ?.command("get <kn-id> <at-id>")
    .description("Get an action type")
    .action(async (knId: string, atId: string, _o, cmd: Command) => {
      printJson(await clientFrom(cmd).kn.actionTypeGet(knId, atId), outputOptions(cmd));
    });

  // stats/export are aliases of `get --stats` / `get --export`.
  bkn
    .command("stats <kn-id>")
    .description("Get knowledge-network statistics (alias for get --stats)")
    .action(async (knId: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).kn.get(knId, { stats: true }), outputOptions(cmd));
    });
  bkn
    .command("export <kn-id>")
    .description("Export a knowledge network (alias for get --export)")
    .action(async (knId: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).kn.get(knId, { exportMode: true }), outputOptions(cmd));
    });

  // Real object-type instance query + properties (the rest are stubs above).
  const objectType = bkn.commands.find((c) => c.name() === "object-type");
  objectType
    ?.command("query <kn-id> <ot-id>")
    .description("Query instances of an object type (--body / --body-file JSON)")
    .option("--body <json>", "query JSON")
    .option("--body-file <path>", "read query JSON from a file")
    .action(async (knId: string, otId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).kn.objectTypeQuery(knId, otId, readBody(opts)),
        outputOptions(cmd),
      );
    });
  // `object-type properties` is gone: the ontology-query route was removed.
  // Computed/logic properties come from the MCP surface now
  // (`openbkn context get-logic-properties`).

  bkn
    .command("create <name>")
    .description("Create an (empty) knowledge network")
    .option("--branch <b>", "branch", "main")
    .action(async (name: string, opts, cmd: Command) => {
      printJson(await clientFrom(cmd).kn.create({ name, branch: opts.branch }), outputOptions(cmd));
    });

  bkn
    .command("update <kn-id>")
    .description("Update a knowledge network (--body / --body-file)")
    .option("--body <json>", "update body JSON")
    .option("--body-file <path>", "read update body JSON from a file")
    .action(async (knId: string, opts, cmd: Command) => {
      printJson(await clientFrom(cmd).kn.update(knId, readBody(opts)), outputOptions(cmd));
    });

  bkn
    .command("delete <kn-id>")
    .description("Delete a knowledge network")
    .option("-y, --yes", "skip confirmation")
    .action(async (knId: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).kn.delete(knId), outputOptions(cmd));
    });

  bkn
    .command("subgraph <kn-id>")
    .description("Query a subgraph (--body / --body-file JSON)")
    .option("--body <json>", "subgraph query JSON")
    .option("--body-file <path>", "read subgraph query JSON from a file")
    .action(async (knId: string, opts, cmd: Command) => {
      printJson(await clientFrom(cmd).kn.subgraph(knId, readBody(opts)), outputOptions(cmd));
    });

  const actionLog = bkn.command("action-log").description("Action logs — list/get/cancel");
  actionLog
    .command("list <kn-id>")
    .description("List action logs")
    .option("--status <s>", "filter by status")
    .option("--action-type-id <id>", "filter by action type")
    .option("--limit <n>", "page size", int, DEFAULT_LIST_LIMIT)
    .action(async (knId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).kn.actionLogs(knId, {
          status: opts.status,
          actionTypeId: opts.actionTypeId,
          limit: opts.limit,
        }),
        outputOptions(cmd),
      );
    });
  actionLog
    .command("get <kn-id> <log-id>")
    .description("Get an action log")
    .action(async (knId: string, logId: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).kn.actionLog(knId, logId), outputOptions(cmd));
    });
  actionLog
    .command("cancel <kn-id> <log-id>")
    .description("Cancel a running action")
    .action(async (knId: string, logId: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).kn.cancelActionLog(knId, logId), outputOptions(cmd));
    });

  bkn
    .command("action-execution <kn-id> <execution-id>")
    .description("Get action execution status")
    .action(async (knId: string, execId: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).kn.actionExecution(knId, execId), outputOptions(cmd));
    });

  const metric = bkn.command("metric").description("Metrics — query / dry-run");
  metric
    .command("query <kn-id> <metric-id>")
    .description("Query a metric's data (--body / --body-file JSON)")
    .option("--body <json>", "query JSON")
    .option("--body-file <path>", "read query JSON from a file")
    .action(async (knId: string, metricId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).kn.metricQuery(knId, metricId, readBody(opts)),
        outputOptions(cmd),
      );
    });
  metric
    .command("dry-run <kn-id>")
    .description("Dry-run a metric definition (--body / --body-file JSON)")
    .option("--body <json>", "metric definition JSON")
    .option("--body-file <path>", "read metric definition JSON from a file")
    .action(async (knId: string, opts, cmd: Command) => {
      printJson(await clientFrom(cmd).kn.metricDryRun(knId, readBody(opts)), outputOptions(cmd));
    });
  metric
    .command("list <kn-id>")
    .description("List metrics")
    .action(async (knId: string, _o, cmd: Command) => {
      printJson(await clientFrom(cmd).kn.metricList(knId), outputOptions(cmd));
    });
  metric
    .command("get <kn-id> <metric-id>")
    .description("Get a metric")
    .action(async (knId: string, id: string, _o, cmd: Command) => {
      printJson(await clientFrom(cmd).kn.metricGet(knId, id), outputOptions(cmd));
    });
  metric
    .command("create <kn-id>")
    .description("Create a metric (--body / --body-file)")
    .option("--body <json>", "body JSON")
    .option("--body-file <path>", "read body JSON from a file")
    .action(async (knId: string, opts, cmd: Command) => {
      printJson(await clientFrom(cmd).kn.metricCreate(knId, readBody(opts)), outputOptions(cmd));
    });
  metric
    .command("update <kn-id> <metric-id>")
    .description("Update a metric (--body / --body-file)")
    .option("--body <json>", "body JSON")
    .option("--body-file <path>", "read body JSON from a file")
    .action(async (knId: string, id: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).kn.metricUpdate(knId, id, readBody(opts)),
        outputOptions(cmd),
      );
    });
  metric
    .command("delete <kn-id> <metric-id>")
    .description("Delete a metric")
    .action(async (knId: string, id: string, _o, cmd: Command) => {
      printJson(await clientFrom(cmd).kn.metricDelete(knId, id), outputOptions(cmd));
    });
  metric
    .command("search <kn-id>")
    .description("Search metrics (--body / --body-file)")
    .option("--body <json>", "body JSON")
    .option("--body-file <path>", "read body JSON from a file")
    .action(async (knId: string, opts, cmd: Command) => {
      printJson(await clientFrom(cmd).kn.metricSearch(knId, readBody(opts)), outputOptions(cmd));
    });
  metric
    .command("validate <kn-id>")
    .description("Validate a metric definition (--body / --body-file)")
    .option("--body <json>", "body JSON")
    .option("--body-file <path>", "read body JSON from a file")
    .action(async (knId: string, opts, cmd: Command) => {
      printJson(await clientFrom(cmd).kn.metricValidate(knId, readBody(opts)), outputOptions(cmd));
    });

  const cg = bkn.command("concept-group").description("Concept groups — list/get");
  cg.command("list <kn-id>")
    .description("List concept groups")
    .action(async (knId: string, _o, cmd: Command) => {
      printJson(await clientFrom(cmd).kn.conceptGroups(knId), outputOptions(cmd));
    });
  cg.command("get <kn-id> <cg-id>")
    .description("Get a concept group")
    .action(async (knId: string, cgId: string, _o, cmd: Command) => {
      printJson(await clientFrom(cmd).kn.conceptGroup(knId, cgId), outputOptions(cmd));
    });
  cg.command("create <kn-id>")
    .description("Create a concept group (--body / --body-file)")
    .option("--body <json>", "body JSON")
    .option("--body-file <path>", "read body JSON from a file")
    .action(async (knId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).kn.conceptGroupCreate(knId, readBody(opts)),
        outputOptions(cmd),
      );
    });
  cg.command("update <kn-id> <cg-id>")
    .description("Update a concept group (--body / --body-file)")
    .option("--body <json>", "body JSON")
    .option("--body-file <path>", "read body JSON from a file")
    .action(async (knId: string, cgId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).kn.conceptGroupUpdate(knId, cgId, readBody(opts)),
        outputOptions(cmd),
      );
    });
  cg.command("delete <kn-id> <cg-id>")
    .description("Delete a concept group")
    .action(async (knId: string, cgId: string, _o, cmd: Command) => {
      printJson(await clientFrom(cmd).kn.conceptGroupDelete(knId, cgId), outputOptions(cmd));
    });
  cg.command("add-members <kn-id> <cg-id>")
    .description("Add object types to a concept group (--body / --body-file)")
    .option("--body <json>", "body JSON")
    .option("--body-file <path>", "read body JSON from a file")
    .action(async (knId: string, cgId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).kn.conceptGroupAddMembers(knId, cgId, readBody(opts)),
        outputOptions(cmd),
      );
    });
  cg.command("remove-members <kn-id> <cg-id> <ot-ids>")
    .description("Remove object types (comma-joined ids) from a concept group")
    .action(async (knId: string, cgId: string, otIds: string, _o, cmd: Command) => {
      printJson(
        await clientFrom(cmd).kn.conceptGroupRemoveMembers(knId, cgId, otIds),
        outputOptions(cmd),
      );
    });

  const sched = bkn.command("action-schedule").description("Action schedules — list/get");
  sched
    .command("list <kn-id>")
    .description("List action schedules")
    .action(async (knId: string, _o, cmd: Command) => {
      printJson(await clientFrom(cmd).kn.actionSchedules(knId), outputOptions(cmd));
    });
  sched
    .command("get <kn-id> <schedule-id>")
    .description("Get an action schedule")
    .action(async (knId: string, sId: string, _o, cmd: Command) => {
      printJson(await clientFrom(cmd).kn.actionSchedule(knId, sId), outputOptions(cmd));
    });
  sched
    .command("create <kn-id>")
    .description("Create an action schedule (--body / --body-file)")
    .option("--body <json>", "body JSON")
    .option("--body-file <path>", "read body JSON from a file")
    .action(async (knId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).kn.actionScheduleCreate(knId, readBody(opts)),
        outputOptions(cmd),
      );
    });
  sched
    .command("update <kn-id> <schedule-id>")
    .description("Update an action schedule (--body / --body-file)")
    .option("--body <json>", "body JSON")
    .option("--body-file <path>", "read body JSON from a file")
    .action(async (knId: string, sId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).kn.actionScheduleUpdate(knId, sId, readBody(opts)),
        outputOptions(cmd),
      );
    });
  sched
    .command("set-status <kn-id> <schedule-id>")
    .description("Set an action schedule's status (--body / --body-file)")
    .option("--body <json>", "body JSON")
    .option("--body-file <path>", "read body JSON from a file")
    .action(async (knId: string, sId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).kn.actionScheduleSetStatus(knId, sId, readBody(opts)),
        outputOptions(cmd),
      );
    });
  sched
    .command("delete <kn-id> <schedule-ids>")
    .description("Delete action schedule(s) (comma-joined ids)")
    .action(async (knId: string, ids: string, _o, cmd: Command) => {
      printJson(await clientFrom(cmd).kn.actionScheduleDelete(knId, ids), outputOptions(cmd));
    });

  // `bkn job …` is gone: the backend dropped KN-level build jobs, and index
  // builds are Vega build tasks now (`openbkn vega dataset build*`).

  bkn
    .command("push <directory>")
    .description("Pack a BKN directory into a tar and import it as a knowledge network")
    .option("--branch <name>", "target branch", "main")
    .option("--build", "submit a Vega build task for each object type declaring a vector index")
    .option("--embedding-model <id>", "small-model ID for declared vector indexes (with --build)")
    .action(async (dir: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).kn.push(dir, {
          branch: opts.branch,
          build: Boolean(opts.build),
          embeddingModel: opts.embeddingModel,
        }),
        outputOptions(cmd),
      );
    });
  bkn
    .command("pull <kn-id> [directory]")
    .description("Download a knowledge network as a BKN tar and extract it locally")
    .option("--branch <name>", "source branch", "main")
    .action(async (knId: string, dir: string | undefined, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).kn.pull(knId, dir ?? knId, { branch: opts.branch }),
        outputOptions(cmd),
      );
    });

  bkn
    .command("relation-type-paths <kn-id>")
    .description("Query relation-type paths between object types (--body / --body-file JSON)")
    .option("--body <json>", "request JSON")
    .option("--body-file <path>", "read request JSON from a file")
    .action(async (knId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).kn.relationTypePaths(knId, readBody(opts)),
        outputOptions(cmd),
      );
    });

  bkn
    .command("resources")
    .description("List BKN-backend resources")
    .action(async (_opts, cmd: Command) => {
      printJson(await clientFrom(cmd).kn.bknResources(), outputOptions(cmd));
    });

  bkn
    .command("create-from-catalog <catalog-id>")
    .description("Build a knowledge network from a Vega catalog's tables")
    .requiredOption("--name <name>", "knowledge network name")
    .option("--tables <list>", "comma-separated table names (default: all)")
    .option("--pk-map <map>", "explicit primary keys: '<table>:<col>[,<table>:<col>...]'")
    .option("--build", "submit a Vega build task per resource after creation")
    .option(
      "--embedding-fields <map>",
      "columns to vectorize per table (with --build): '<table>:<col>[+<col>...][,...]'",
    )
    .option("--embedding-model <id>", "small-model ID for the vector index (with --build)")
    .option("--no-rollback", "keep a partially-created KN on failure")
    .action(async (catalogId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).kn.createFromCatalog({
          catalogId,
          name: opts.name,
          tables: csv(opts.tables),
          pkMap: opts.pkMap ? parsePkMap(opts.pkMap) : undefined,
          build: Boolean(opts.build),
          embeddingFields: opts.embeddingFields
            ? parseEmbeddingFields(opts.embeddingFields)
            : undefined,
          embeddingModel: opts.embeddingModel,
          noRollback: opts.rollback === false,
          onProgress: (m) => console.error(m),
        }),
        outputOptions(cmd),
      );
    });

  bkn
    .command("validate <directory>")
    .description("Validate a local BKN directory's structure (offline)")
    .action(async (dir: string, _opts, cmd: Command) => {
      const result = validateBknDirectory(dir);
      printJson(result, outputOptions(cmd));
      if (!result.valid) process.exitCode = 1;
    });

  bkn
    .command("create-from-csv <catalog-id>")
    .description("Import CSV files into a Vega catalog, then build a KN from them")
    .requiredOption("--files <glob>", "CSV paths (comma-separated or glob)")
    .requiredOption("--name <name>", "knowledge network name")
    .option("--table-prefix <s>", "prefix for derived table names", "")
    .option("--batch-size <n>", "rows per insert batch", int, 500)
    .option("--tables <list>", "subset of imported tables to include in the KN")
    .option("--pk-map <map>", "explicit primary keys: '<table>:<col>[,...]'")
    .option("--build", "submit a Vega build task per resource after creation")
    .option(
      "--embedding-fields <map>",
      "columns to vectorize per table (with --build): '<table>:<col>[+<col>...][,...]'",
    )
    .option("--embedding-model <id>", "small-model ID for the vector index (with --build)")
    .option("--no-rollback", "keep a partially-created KN on failure")
    .action(async (catalogId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).kn.createFromCsv({
          catalogId,
          name: opts.name,
          files: opts.files,
          tablePrefix: opts.tablePrefix,
          batchSize: opts.batchSize,
          tables: csv(opts.tables),
          pkMap: opts.pkMap ? parsePkMap(opts.pkMap) : undefined,
          build: Boolean(opts.build),
          embeddingFields: opts.embeddingFields
            ? parseEmbeddingFields(opts.embeddingFields)
            : undefined,
          embeddingModel: opts.embeddingModel,
          noRollback: opts.rollback === false,
          onProgress: (m) => console.error(m),
        }),
        outputOptions(cmd),
      );
    });

  return group(bkn, "AI DATA PLATFORM");
}
