// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** `openbkn bkn …` — knowledge networks. */
import { Command } from "commander";
import type { CapabilityAttachEntry } from "../api/bkn-backend.js";
import { group, groupChildren, guide } from "../help/grouped-help.js";
import { DEFAULT_LIST_LIMIT } from "../types.js";
import { type CapabilityCheck, validateBknDirectory } from "../utils/bkn-validate.js";
import { InputError } from "../utils/errors.js";
import { printJson } from "../utils/output.js";
import { parsePkMap } from "../utils/pk-detection.js";
import { clientFrom, csv, cypherParams, outputOptions, readBody } from "./_shared.js";

const int = (v: string) => Number.parseInt(v, 10);

const CAPABILITY_TYPES = ["skill", "function", "mcp_tool"];

/**
 * Turn `capability attach` flags into mount entries. Exactly one target kind per call, and
 * a box or server needs --tool or --all-tools: a binding is always to tools, so a bare box
 * has no default meaning and is refused rather than read as "all of it".
 */
export function capabilityEntries(opts: {
  skill?: string;
  box?: string;
  mcp?: string;
  tool?: string;
  allTools?: boolean;
  comment?: string;
}): CapabilityAttachEntry[] {
  const targets = [opts.skill, opts.box, opts.mcp].filter((v) => v !== undefined);
  if (targets.length !== 1) {
    throw new InputError(
      "Name exactly one of --skill <ids>, --box <box-id> or --mcp <mcp-id> to attach.",
    );
  }
  const comment = opts.comment || undefined;
  if (opts.skill !== undefined) {
    if (opts.tool !== undefined || opts.allTools) {
      throw new InputError("--tool and --all-tools go with --box or --mcp, not --skill.");
    }
    const ids = csv(opts.skill) ?? [];
    if (ids.length === 0) throw new InputError("--skill needs at least one skill id.");
    return ids.map((id) => ({ capability_type: "skill", capability_id: id, comment }));
  }

  const flag = opts.box !== undefined ? "--box" : "--mcp";
  const owner = (opts.box ?? opts.mcp ?? "").trim();
  const type = opts.box !== undefined ? "function" : "mcp_tool";
  if (!owner) throw new InputError(`${flag} needs an id.`);
  if (opts.tool !== undefined && opts.allTools) {
    throw new InputError("Use --tool or --all-tools, not both.");
  }
  if (opts.allTools) return [{ capability_type: type, box_id: owner, all_tools: true, comment }];
  const tools = csv(opts.tool) ?? [];
  if (tools.length === 0) {
    throw new InputError(
      `${flag} binds tools, not the container: add --tool <ids> or --all-tools.`,
    );
  }
  return tools.map((tool) => ({
    capability_type: type,
    box_id: owner,
    capability_id: tool,
    comment,
  }));
}

/**
 * Say on stderr what push left unbound. The JSON answer carries `capabilities.skipped`,
 * but a push that answers with a kn_id reads as done, and a skipped capability is exactly
 * what that reader misses: the network imports, and its SKILLs list is empty. A section
 * the backend could not decode is dropped without a skip entry, so the local check names it.
 */
export function warnUnboundCapabilities(result: unknown, declared: CapabilityCheck): void {
  if (declared.malformed) {
    process.stderr.write(
      `warning: network.bkn capabilities ${declared.malformed}; none of it was bound.\n`,
    );
  }
  const report = (result as { capabilities?: { skipped?: unknown } } | undefined)?.capabilities;
  const skipped = Array.isArray(report?.skipped)
    ? (report.skipped as Array<Record<string, unknown>>)
    : [];
  if (skipped.length === 0) return;
  const noun = skipped.length === 1 ? "capability was" : "capabilities were";
  process.stderr.write(`warning: ${skipped.length} declared ${noun} not bound:\n`);
  for (const skip of skipped) {
    const owner = skip.box_name ? `${skip.box_name} / ` : "";
    const name = skip.name || skip.declared_id || "(unnamed)";
    const detail = skip.detail ? ` — ${skip.detail}` : "";
    process.stderr.write(`  ${skip.capability_type} ${owner}${name}: ${skip.reason}${detail}\n`);
  }
}

export function bknCommand(): Command {
  const bkn = new Command("bkn").description(
    "Knowledge networks: schema, metrics, search, import/export",
  );

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
    .description(
      "Recall instances from a plain sentence — no object type or field names needed → {nodes, object_types}",
    )
    .option("--object-types <ids>", "pin recall to these object-type ids (comma-separated)")
    .option("--exclude-object-types <ids>", "drop these object-type ids (comma-separated)")
    .option("--concept-groups <names>", "limit recall to these concept groups (comma-separated)")
    .option("--max-object-types <n>", "how many object types may take part", int)
    .option("--max-instances <n>", "instances per object type", int)
    .option("--rerank", "re-rank hits with a cross-encoder (needs a rerank model deployed)")
    .option("--no-object-types-detail", "omit the object-type definitions that come with hits")
    .action(async (knId: string, query: string, opts, cmd: Command) => {
      const data = await clientFrom(cmd).kn.search(knId, query, {
        objectTypes: csv(opts.objectTypes),
        excludeObjectTypes: csv(opts.excludeObjectTypes),
        conceptGroups: csv(opts.conceptGroups),
        maxObjectTypes: opts.maxObjectTypes,
        maxInstancesPerType: opts.maxInstances,
        rerank: opts.rerank,
        includeObjectTypes: opts.objectTypesDetail === false ? false : undefined,
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
        // The backend route takes a list of ids, so a single get answers an envelope.
        .description(`Get ${name} → {entries}`)
        .action(async (knId: string, id: string, _o, cmd: Command) => {
          printJson(await clientFrom(cmd).kn[`${crud}Get`](knId, id), outputOptions(cmd));
        });
      g.command("create <kn-id>")
        .description(`Create ${name} (--body / --body-file)`)
        .option(
          "--body <json>",
          "body JSON — docs: https://openbkn-ai.github.io/bkn-foundry/ (bkn-backend)",
        )
        .option("--body-file <path>", "read body JSON from a file")
        .action(async (knId: string, opts, cmd: Command) => {
          printJson(
            await clientFrom(cmd).kn[`${crud}Create`](knId, readBody(opts)),
            outputOptions(cmd),
          );
        });
      g.command("update <kn-id> <id>")
        .description(`Update ${name} (--body / --body-file)`)
        .option(
          "--body <json>",
          "body JSON — docs: https://openbkn-ai.github.io/bkn-foundry/ (bkn-backend)",
        )
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
    .option(
      "--body <json>",
      "query JSON — docs: https://openbkn-ai.github.io/bkn-foundry/ (ontology-query)",
    )
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
    .option(
      "--body <json>",
      "execution envelope JSON — docs: https://openbkn-ai.github.io/bkn-foundry/ (ontology-query)",
    )
    .option("--body-file <path>", "read envelope JSON from a file")
    .action(async (knId: string, atId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).kn.actionTypeExecute(knId, atId, readBody(opts)),
        outputOptions(cmd),
      );
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
    .option(
      "--body <json>",
      "query JSON — docs: https://openbkn-ai.github.io/bkn-foundry/ (ontology-query)",
    )
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
    .option(
      "--body <json>",
      "update body JSON — docs: https://openbkn-ai.github.io/bkn-foundry/ (bkn-backend)",
    )
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
    .option(
      "--body <json>",
      "subgraph query JSON — docs: https://openbkn-ai.github.io/bkn-foundry/ (ontology-query)",
    )
    .option("--body-file <path>", "read subgraph query JSON from a file")
    .action(async (knId: string, opts, cmd: Command) => {
      printJson(await clientFrom(cmd).kn.subgraph(knId, readBody(opts)), outputOptions(cmd));
    });

  const actionLog = bkn
    .command("action-log")
    .description("Action logs — list/get/cancel; list pages with search_after");
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
    .option(
      "--body <json>",
      "query JSON — docs: https://openbkn-ai.github.io/bkn-foundry/ (ontology-query)",
    )
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
    .option(
      "--body <json>",
      "metric definition JSON — docs: https://openbkn-ai.github.io/bkn-foundry/ (ontology-query)",
    )
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
    .description("Get a metric → {entries}, since the route takes a list of ids")
    .action(async (knId: string, id: string, _o, cmd: Command) => {
      printJson(await clientFrom(cmd).kn.metricGet(knId, id), outputOptions(cmd));
    });
  metric
    .command("create <kn-id>")
    .description("Create a metric (--body / --body-file)")
    .option(
      "--body <json>",
      "body JSON — docs: https://openbkn-ai.github.io/bkn-foundry/ (bkn-backend)",
    )
    .option("--body-file <path>", "read body JSON from a file")
    .action(async (knId: string, opts, cmd: Command) => {
      printJson(await clientFrom(cmd).kn.metricCreate(knId, readBody(opts)), outputOptions(cmd));
    });
  metric
    .command("update <kn-id> <metric-id>")
    .description("Update a metric (--body / --body-file)")
    .option(
      "--body <json>",
      "body JSON — docs: https://openbkn-ai.github.io/bkn-foundry/ (bkn-backend)",
    )
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
    .command("validate <kn-id>")
    .description("Validate a metric definition (--body / --body-file)")
    .option(
      "--body <json>",
      "body JSON — docs: https://openbkn-ai.github.io/bkn-foundry/ (bkn-backend)",
    )
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
    .option(
      "--body <json>",
      "body JSON — docs: https://openbkn-ai.github.io/bkn-foundry/ (bkn-backend)",
    )
    .option("--body-file <path>", "read body JSON from a file")
    .action(async (knId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).kn.conceptGroupCreate(knId, readBody(opts)),
        outputOptions(cmd),
      );
    });
  cg.command("update <kn-id> <cg-id>")
    .description("Update a concept group (--body / --body-file)")
    .option(
      "--body <json>",
      "body JSON — docs: https://openbkn-ai.github.io/bkn-foundry/ (bkn-backend)",
    )
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
    .option(
      "--body <json>",
      "body JSON — docs: https://openbkn-ai.github.io/bkn-foundry/ (bkn-backend)",
    )
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
    .option(
      "--body <json>",
      "body JSON — docs: https://openbkn-ai.github.io/bkn-foundry/ (bkn-backend)",
    )
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
    .option(
      "--body <json>",
      "body JSON — docs: https://openbkn-ai.github.io/bkn-foundry/ (bkn-backend)",
    )
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
    .option(
      "--body <json>",
      "body JSON — docs: https://openbkn-ai.github.io/bkn-foundry/ (bkn-backend)",
    )
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

  const capability = bkn
    .command("capability")
    .description("Skills, tool box tools and MCP tools bound to a network — list/attach/detach");
  capability
    .command("list <kn-id>")
    .description("List what the network has bound → {entries, boxes, total_count, …}")
    .option("--type <type>", "skill | function | mcp_tool")
    .option("--box <box-id>", "only the tools of this tool box or MCP Server")
    .option("--metadata-type <kind>", "only function bindings whose tool box is openapi | function")
    .option("--with-detail", "also fill description and status (one extra call per skill)")
    .option("--branch <name>", "knowledge network branch (default: main)")
    .option("--limit <n>", "page size", int)
    .option("--offset <n>", "page offset", int)
    .action(async (knId: string, opts, cmd: Command) => {
      if (opts.type && !CAPABILITY_TYPES.includes(opts.type)) {
        throw new InputError(`--type must be one of ${CAPABILITY_TYPES.join(", ")}.`);
      }
      printJson(
        await clientFrom(cmd).kn.capabilityList(knId, {
          branch: opts.branch,
          type: opts.type,
          boxId: opts.box,
          metadataType: opts.metadataType,
          withDetail: opts.withDetail,
          limit: opts.limit,
          offset: opts.offset,
        }),
        outputOptions(cmd),
      );
    });
  capability
    .command("attach <kn-id>")
    .description("Bind skills, tool box tools or MCP tools; binding one twice is a no-op")
    .option("--skill <ids>", "skill ids (comma-separated)")
    .option("--box <box-id>", "a tool box — name its tools with --tool, or take --all-tools")
    .option("--mcp <mcp-id>", "an MCP Server — name its tools with --tool, or take --all-tools")
    .option("--tool <ids>", "tool ids for --box, tool names for --mcp (comma-separated)")
    .option("--all-tools", "every enabled tool the box or server holds now")
    .option("--comment <text>", "note stored on each new binding")
    .option("--branch <name>", "knowledge network branch (default: main)")
    .addHelpText(
      "after",
      `
A binding is always to a tool, never to a box. --all-tools is expanded when you run it
into one binding per tool the box holds at that moment; a tool added to the box later is
not bound until you attach it (\`capability list\` counts it under boxes[].unmounted_tools).

  openbkn bkn capability attach <kn-id> --skill <skill-id>
  openbkn bkn capability attach <kn-id> --box <box-id> --tool <tool-id>[,<tool-id>]
  openbkn bkn capability attach <kn-id> --box <box-id> --all-tools
  openbkn bkn capability attach <kn-id> --mcp <mcp-id> --tool <tool-name>`,
    )
    .action(async (knId: string, opts, cmd: Command) => {
      const entries = capabilityEntries(opts);
      printJson(
        await clientFrom(cmd).kn.capabilityAttach(knId, entries, { branch: opts.branch }),
        outputOptions(cmd),
      );
    });
  capability
    .command("detach <kn-id> <binding-ids>")
    .description("Release bindings by id (comma-separated, from `capability list`)")
    .option("--branch <name>", "knowledge network branch (default: main)")
    .action(async (knId: string, ids: string, opts, cmd: Command) => {
      const bindingIds = csv(ids) ?? [];
      if (bindingIds.length === 0) throw new InputError("Name at least one binding id.");
      await clientFrom(cmd).kn.capabilityDetach(knId, bindingIds, { branch: opts.branch });
      printJson(
        { kn_id: knId, branch: opts.branch ?? "main", detached: bindingIds },
        outputOptions(cmd),
      );
    });

  // `bkn job …` is gone: the backend dropped KN-level build jobs, and index
  // builds are Vega build tasks now (`openbkn vega dataset build*`).

  bkn
    .command("push <directory>")
    .description("Pack a BKN directory into a tar and import it as a knowledge network")
    .option("--branch <name>", "target branch", "main")
    .action(async (dir: string, opts, cmd: Command) => {
      const declared = validateBknDirectory(dir).capabilities;
      const result = await clientFrom(cmd).kn.push(dir, { branch: opts.branch });
      warnUnboundCapabilities(result, declared);
      printJson(result, outputOptions(cmd));
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
    .option(
      "--body <json>",
      "request JSON — docs: https://openbkn-ai.github.io/bkn-foundry/ (bkn-backend)",
    )
    .option("--body-file <path>", "read request JSON from a file")
    .action(async (knId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).kn.relationTypePaths(knId, readBody(opts)),
        outputOptions(cmd),
      );
    });

  bkn
    .command("cypher <kn-id>")
    .description(
      "Answer a read-only Cypher query over the network's model, outside any Trace session",
    )
    .requiredOption(
      "--query <cypher>",
      "read-only Cypher: labels are object types, relationship types are relation types",
    )
    .option(
      "--params <json>",
      "values for $name placeholders, as a JSON object: '{\"floor\": 100}'",
    )
    .option("--branch <branch>", "knowledge network branch (default: main)")
    .addHelpText(
      "after",
      `
The compiler behind \`openbkn context run-cypher\`, called directly: the same subset,
the same limits, the same refusals naming the construct and its position. Answers
{columns, entries}; the generated SQL is never returned. Nothing is recorded in BKN
Trace — use context run-cypher when the query is part of a conversation an agent
should be able to account for.

  openbkn bkn cypher <kn-id> \\
    --query "MATCH (c:customer)<-[:rel_order_customer]-(o:order) RETURN c.city AS city, count(*) AS orders"`,
    )
    .action(async (knId: string, opts, cmd: Command) => {
      if (!opts.query.trim()) throw new InputError("--query must not be empty.");
      printJson(
        await clientFrom(cmd).kn.cypher(knId, opts.query, {
          branch: opts.branch,
          parameters: cypherParams(opts.params),
        }),
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
    .option("--no-rollback", "keep a partially-created KN on failure")
    .action(async (catalogId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).kn.createFromCatalog({
          catalogId,
          name: opts.name,
          tables: csv(opts.tables),
          pkMap: opts.pkMap ? parsePkMap(opts.pkMap) : undefined,
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

  groupChildren(bkn, {
    GROUPS: [
      "object-type",
      "relation-type",
      "action-type",
      "metric",
      "concept-group",
      "capability",
      "action-log",
      "action-schedule",
    ],
    READ: [
      "pull",
      "list",
      "get",
      "stats",
      "export",
      "search",
      "subgraph",
      "relation-type-paths",
      "cypher",
      "resources",
      "action-execution",
      "validate",
    ],
    WRITE: ["create", "update", "delete", "push", "create-from-catalog"],
  });

  groupChildren(metric, {
    READ: ["list", "get"],
    RUN: ["query", "dry-run", "validate"],
    WRITE: ["create", "update", "delete"],
  });

  groupChildren(capability, {
    READ: ["list"],
    WRITE: ["attach", "detach"],
  });

  guide(
    bkn,
    `WHERE IDS COME FROM
  \`list\` gives kn ids; \`object-type list <kn-id>\` and \`search <kn-id> "<q>"\` give the rest.

SEARCH VS THE MCP SIDE
  \`search\` recalls instance rows from one sentence and ships the object-type definitions
  needed to read them — start here when you do not know the schema yet. It only reaches
  properties indexed for match/knn, so an unindexed object type yields nothing, and no hits
  comes back as empty nodes with a message rather than an error. For schema alone use
  \`openbkn context search-schema\`; for a structured filter use \`object-type query\`.

EDITING SCHEMA AS FILES
  pull <kn-id> ./dir  ->  edit  ->  validate ./dir  ->  push ./dir
  \`validate\` is offline and catches structure errors before the upload.
  network.bkn may declare the skills and tools the network depends on under
  \`capabilities:\`. push binds them by id, then by name; one this platform cannot
  resolve is skipped, not fatal, and push lists every skip on stderr.

CAPABILITIES
  \`capability list <kn-id>\` shows what a network has bound — the set Context Loader
  recalls skills and tools from; a network with nothing bound recalls nothing.

REQUEST BODIES
  create/update take a definition; query/execute/dry-run take a query. Both are documented
  at https://openbkn-ai.github.io/bkn-foundry/ — definitions under bkn-backend, reads and
  executions under ontology-query. Each command's --body flag names its own module.

CREATING FROM DATA
  create-from-catalog <catalog-id> --name "<n>" builds a network from a Vega catalog,
  then \`openbkn vega dataset build <resource-id>\` produces the index. There is no
  whole-network build.`,
  );
  return group(bkn, "DATA & KNOWLEDGE");
}
