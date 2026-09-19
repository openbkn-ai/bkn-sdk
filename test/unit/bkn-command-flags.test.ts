// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const kn = vi.hoisted(() => {
  const ok = () => vi.fn(async (..._args: unknown[]) => ({ ok: true }));
  return {
    bknResources: ok(),
    actionLogs: ok(),
    actionLog: ok(),
    cancelActionLog: ok(),
    subgraph: ok(),
    objectTypeQuery: ok(),
    objectTypeDelete: ok(),
    relationTypeDelete: ok(),
    objectTypeUpdate: ok(),
    objectTypes: ok(),
    metricList: ok(),
    metricGet: ok(),
    metricUpdate: ok(),
    metricDelete: ok(),
    metricValidate: ok(),
    conceptGroups: ok(),
    actionSchedules: ok(),
    actionTypeQuery: ok(),
    capabilityList: ok(),
    list: ok(),
    get: ok(),
    create: ok(),
    update: ok(),
    delete: ok(),
    objectTypeCreate: ok(),
    metricCreate: ok(),
    conceptGroupCreate: ok(),
    conceptGroupUpdate: ok(),
    conceptGroupDelete: ok(),
    conceptGroupAddMembers: ok(),
    conceptGroupRemoveMembers: ok(),
    actionSchedule: ok(),
    actionScheduleCreate: ok(),
    actionScheduleUpdate: ok(),
    actionScheduleSetStatus: ok(),
    actionScheduleDelete: ok(),
    relationTypePaths: ok(),
  };
});

vi.mock("../../src/commands/_shared.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/commands/_shared.js")>();
  return { ...actual, clientFrom: vi.fn(() => ({ kn })) };
});

import { bknCommand, warnUnboundCapabilities } from "../../src/commands/bkn.js";

function run(...argv: string[]): Promise<Command> {
  return new Command("openbkn")
    .exitOverride()
    .option("--json")
    .option("--compact")
    .addCommand(bknCommand())
    .parseAsync(["node", "openbkn", "--json", "bkn", ...argv]);
}

beforeEach(() => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("openbkn bkn flags", () => {
  it("resources passes keyword and paging", async () => {
    await run("resources", "--keyword", "ord", "--limit", "5", "--direction", "asc");
    expect(kn.bknResources).toHaveBeenCalledWith({
      keyword: "ord",
      limit: 5,
      offset: 0,
      sort: undefined,
      direction: "asc",
    });
  });

  it("action-log list takes search_after paging and time filters", async () => {
    await run(
      "action-log",
      "list",
      "kn-1",
      "--search-after",
      "1704067200000,abc",
      "--start-time-from",
      "10",
      "--keyword",
      "x",
      "--need-total",
      "--trigger-type",
      "manual",
    );
    expect(kn.actionLogs).toHaveBeenCalledWith(
      "kn-1",
      expect.objectContaining({
        searchAfter: "1704067200000,abc",
        startTimeFrom: 10,
        keyword: "x",
        needTotal: true,
        triggerType: "manual",
        limit: 30,
      }),
    );
  });

  it("refuses an out-of-enum value before calling the deploy", async () => {
    await expect(run("action-log", "list", "kn-1", "--status", "done")).rejects.toThrow(
      "--status must be one of",
    );
    await expect(run("subgraph", "kn-1", "--body", "{}", "--query-type", "x")).rejects.toThrow(
      "--query-type must be one of",
    );
    await expect(
      run(
        "object-type",
        "query",
        "kn-1",
        "ot-1",
        "--body",
        "{}",
        "--exclude-system-properties",
        "_id",
      ),
    ).rejects.toThrow("--exclude-system-properties must be one of");
    expect(kn.actionLogs).not.toHaveBeenCalled();
    expect(kn.subgraph).not.toHaveBeenCalled();
    expect(kn.objectTypeQuery).not.toHaveBeenCalled();
  });

  it("subgraph passes --query-type relation_path", async () => {
    await run("subgraph", "kn-1", "--body", "{}", "--query-type", "relation_path");
    expect(kn.subgraph).toHaveBeenCalledWith(
      "kn-1",
      {},
      expect.objectContaining({ queryType: "relation_path" }),
    );
  });

  it("object-type delete --force sends force_delete; relation-type delete has no --force", async () => {
    await run("object-type", "delete", "kn-1", "ot-1", "--force", "--branch", "dev");
    expect(kn.objectTypeDelete).toHaveBeenCalledWith("kn-1", "ot-1", {
      branch: "dev",
      forceDelete: true,
    });
    await expect(run("relation-type", "delete", "kn-1", "rt-1", "--force")).rejects.toThrow();
  });

  it("update sends strict_mode only when turned off", async () => {
    await run("object-type", "update", "kn-1", "ot-1", "--body", "{}");
    expect(kn.objectTypeUpdate).toHaveBeenLastCalledWith(
      "kn-1",
      "ot-1",
      {},
      {
        branch: undefined,
        strictMode: undefined,
      },
    );
    await run("object-type", "update", "kn-1", "ot-1", "--body", "{}", "--no-strict-mode");
    expect(kn.objectTypeUpdate).toHaveBeenLastCalledWith(
      "kn-1",
      "ot-1",
      {},
      {
        branch: undefined,
        strictMode: false,
      },
    );
  });

  it("schema and metric lists take name-pattern, tag and branch", async () => {
    await run("object-type", "list", "kn-1", "--name-pattern", "ord", "--tag", "t");
    expect(kn.objectTypes).toHaveBeenCalledWith("kn-1", {
      branch: "main",
      namePattern: "ord",
      tag: "t",
    });
    await run("metric", "list", "kn-1", "--branch", "dev");
    expect(kn.metricList).toHaveBeenCalledWith("kn-1", {
      branch: "dev",
      namePattern: undefined,
      tag: undefined,
    });
  });

  it("concept-group and action-schedule lists forward filters", async () => {
    await run("concept-group", "list", "kn-1", "--tag", "t", "--limit", "5");
    expect(kn.conceptGroups).toHaveBeenCalledWith(
      "kn-1",
      expect.objectContaining({ tag: "t", limit: 5 }),
    );
    await run("action-schedule", "list", "kn-1", "--status", "inactive");
    expect(kn.actionSchedules).toHaveBeenCalledWith(
      "kn-1",
      expect.objectContaining({ status: "inactive", limit: undefined }),
    );
  });

  it.each([
    [["list"], "name"],
    [["concept-group", "list", "kn-1"], "name"],
    [["action-schedule", "list", "kn-1"], "next_run_time"],
    [["capability", "list", "kn-1"], "create_time"],
  ])("%j forwards --sort %s and --direction inside the spec enums", async (argv, sort) => {
    await run(...argv, "--sort", sort, "--direction", "asc");
    const method = {
      list: kn.list,
      "concept-group": kn.conceptGroups,
      "action-schedule": kn.actionSchedules,
      capability: kn.capabilityList,
    }[argv[0] as string];
    expect(method).toHaveBeenCalledTimes(1);
    const opts = method?.mock.calls[0]?.at(-1);
    expect(opts).toEqual(expect.objectContaining({ sort, direction: "asc" }));
  });

  it("action-schedule list accepts every schedule sort field", async () => {
    for (const sort of ["create_time", "update_time", "next_run_time", "last_run_time", "name"]) {
      await run("action-schedule", "list", "kn-1", "--sort", sort);
    }
    expect(kn.actionSchedules.mock.calls.map((c) => (c.at(-1) as { sort: string }).sort)).toEqual([
      "create_time",
      "update_time",
      "next_run_time",
      "last_run_time",
      "name",
    ]);
  });

  it.each([
    [["list"], "--sort", "create_time"],
    [["list"], "--direction", "desce"],
    [["concept-group", "list", "kn-1"], "--sort", "create_time"],
    [["concept-group", "list", "kn-1"], "--direction", "up"],
    [["action-schedule", "list", "kn-1"], "--sort", "run_time"],
    [["action-schedule", "list", "kn-1"], "--direction", "DESC"],
    [["capability", "list", "kn-1"], "--sort", "name"],
    [["capability", "list", "kn-1"], "--direction", "desce"],
    [["resources"], "--direction", "desce"],
  ])("%j refuses %s %s before calling the deploy", async (argv, flag, value) => {
    await expect(run(...argv, flag, value)).rejects.toThrow(`${flag} must be one of`);
    for (const fn of [
      kn.list,
      kn.conceptGroups,
      kn.actionSchedules,
      kn.capabilityList,
      kn.bknResources,
    ]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it("resources --sort stays free-form: the spec declares no enum for it", async () => {
    await run("resources", "--sort", "update_time");
    expect(kn.bknResources).toHaveBeenCalledWith(expect.objectContaining({ sort: "update_time" }));
  });

  it("metric get, update, delete and validate forward --branch", async () => {
    await run("metric", "get", "kn-1", "m-1", "--branch", "dev");
    expect(kn.metricGet).toHaveBeenCalledWith("kn-1", "m-1", { branch: "dev" });
    await run("metric", "update", "kn-1", "m-1", "--body", "{}", "--branch", "dev");
    expect(kn.metricUpdate).toHaveBeenCalledWith("kn-1", "m-1", {}, { branch: "dev" });
    await run("metric", "delete", "kn-1", "m-1", "--branch", "dev");
    expect(kn.metricDelete).toHaveBeenCalledWith("kn-1", "m-1", { branch: "dev" });
    await run("metric", "validate", "kn-1", "--body", "{}", "--branch", "dev");
    expect(kn.metricValidate).toHaveBeenCalledWith("kn-1", {}, { branch: "dev" });
  });

  it("get passes --detail-level and --branch", async () => {
    await run("get", "kn-1", "--detail-level", "summary", "--branch", "dev");
    expect(kn.get).toHaveBeenCalledWith(
      "kn-1",
      expect.objectContaining({
        detailLevel: "summary",
        branch: "dev",
      }),
    );
  });

  it("create sends --branch to the SDK, which puts it in both query and body", async () => {
    await run("create", "demo", "--branch", "dev");
    expect(kn.create).toHaveBeenLastCalledWith({
      name: "demo",
      branch: "dev",
      strictMode: undefined,
      importMode: undefined,
      bindingPolicy: undefined,
    });
    await run(
      "create",
      "demo",
      "--import-mode",
      "ignore",
      "--no-strict-mode",
      "--binding-policy",
      "detach",
    );
    expect(kn.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        branch: "main",
        importMode: "ignore",
        strictMode: false,
        bindingPolicy: "detach",
      }),
    );
    await expect(run("create", "demo", "--import-mode", "replace")).rejects.toThrow(
      "--import-mode must be one of",
    );
  });

  it("update and delete take --branch; update takes the write modes", async () => {
    await run(
      "update",
      "kn-1",
      "--body",
      "{}",
      "--branch",
      "dev",
      "--no-strict-mode",
      "--import-mode",
      "overwrite",
    );
    expect(kn.update).toHaveBeenCalledWith(
      "kn-1",
      {},
      { branch: "dev", strictMode: false, importMode: "overwrite" },
    );
    await run("delete", "kn-1", "--branch", "dev", "-y");
    expect(kn.delete).toHaveBeenCalledWith("kn-1", { branch: "dev" });
  });

  it("schema and metric creates take --import-mode and --no-strict-mode", async () => {
    await run(
      "object-type",
      "create",
      "kn-1",
      "--body",
      "[]",
      "--import-mode",
      "overwrite",
      "--no-strict-mode",
    );
    expect(kn.objectTypeCreate).toHaveBeenCalledWith("kn-1", [], {
      branch: undefined,
      strictMode: false,
      importMode: "overwrite",
    });
    await run("metric", "create", "kn-1", "--body", "[]", "--import-mode", "ignore");
    expect(kn.metricCreate).toHaveBeenCalledWith(
      "kn-1",
      [],
      expect.objectContaining({ importMode: "ignore", strictMode: undefined }),
    );
    await run("metric", "update", "kn-1", "m-1", "--body", "{}", "--no-strict-mode");
    expect(kn.metricUpdate).toHaveBeenLastCalledWith(
      "kn-1",
      "m-1",
      {},
      expect.objectContaining({ strictMode: false }),
    );
    await run("metric", "validate", "kn-1", "--body", "{}", "--import-mode", "overwrite");
    expect(kn.metricValidate).toHaveBeenLastCalledWith(
      "kn-1",
      {},
      expect.objectContaining({ importMode: "overwrite" }),
    );
    // Update has no import_mode in the contract.
    await expect(
      run("metric", "update", "kn-1", "m-1", "--body", "{}", "--import-mode", "ignore"),
    ).rejects.toThrow();
  });

  it("concept-group writes forward --branch and their write modes", async () => {
    await run(
      "concept-group",
      "create",
      "kn-1",
      "--body",
      "{}",
      "--branch",
      "dev",
      "--import-mode",
      "ignore",
    );
    expect(kn.conceptGroupCreate).toHaveBeenCalledWith(
      "kn-1",
      {},
      { branch: "dev", strictMode: undefined, importMode: "ignore" },
    );
    await run("concept-group", "update", "kn-1", "cg-1", "--body", "{}", "--no-strict-mode");
    expect(kn.conceptGroupUpdate).toHaveBeenCalledWith(
      "kn-1",
      "cg-1",
      {},
      expect.objectContaining({ strictMode: false }),
    );
    await run("concept-group", "delete", "kn-1", "cg-1", "--branch", "dev");
    expect(kn.conceptGroupDelete).toHaveBeenCalledWith("kn-1", "cg-1", { branch: "dev" });
    await run("concept-group", "add-members", "kn-1", "cg-1", "--body", "{}", "--branch", "dev");
    expect(kn.conceptGroupAddMembers).toHaveBeenCalledWith(
      "kn-1",
      "cg-1",
      {},
      expect.objectContaining({ branch: "dev" }),
    );
    await run("concept-group", "remove-members", "kn-1", "cg-1", "a,b", "--branch", "dev");
    expect(kn.conceptGroupRemoveMembers).toHaveBeenCalledWith("kn-1", "cg-1", "a,b", {
      branch: "dev",
    });
  });

  it("action-schedule get/create/update/set-status/delete forward --branch", async () => {
    await run("action-schedule", "get", "kn-1", "s-1", "--branch", "dev");
    expect(kn.actionSchedule).toHaveBeenCalledWith("kn-1", "s-1", { branch: "dev" });
    await run("action-schedule", "create", "kn-1", "--body", "{}", "--branch", "dev");
    expect(kn.actionScheduleCreate).toHaveBeenCalledWith("kn-1", {}, { branch: "dev" });
    await run("action-schedule", "update", "kn-1", "s-1", "--body", "{}", "--branch", "dev");
    expect(kn.actionScheduleUpdate).toHaveBeenCalledWith("kn-1", "s-1", {}, { branch: "dev" });
    await run("action-schedule", "set-status", "kn-1", "s-1", "--body", "{}", "--branch", "dev");
    expect(kn.actionScheduleSetStatus).toHaveBeenCalledWith("kn-1", "s-1", {}, { branch: "dev" });
    await run("action-schedule", "delete", "kn-1", "s-1,s-2", "--branch", "dev");
    expect(kn.actionScheduleDelete).toHaveBeenCalledWith("kn-1", "s-1,s-2", { branch: "dev" });
  });

  it("relation-type-paths forwards --branch", async () => {
    await run("relation-type-paths", "kn-1", "--body", "{}", "--branch", "dev");
    expect(kn.relationTypePaths).toHaveBeenCalledWith("kn-1", {}, { branch: "dev" });
  });

  it("bkn list --limit takes 1–1000 or -1", async () => {
    await run("list", "--limit", "-1");
    expect(kn.list).toHaveBeenLastCalledWith(expect.objectContaining({ limit: -1 }));
    await run("list", "--limit", "1000");
    expect(kn.list).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 1000 }));
    for (const bad of ["0", "1001", "-2", "abc"]) {
      await expect(run("list", "--limit", bad)).rejects.toThrow("--limit must be an integer");
    }
    expect(kn.list).toHaveBeenCalledTimes(2);
  });

  it("action-log bounds are checked before calling the deploy", async () => {
    await expect(run("action-log", "list", "kn-1", "--limit", "1001")).rejects.toThrow(
      "--limit must be an integer from 1 to 1000",
    );
    await expect(run("action-log", "list", "kn-1", "--keyword", "x".repeat(129))).rejects.toThrow(
      "--keyword must be at most 128 characters",
    );
    // Length is measured on the string that is sent, untrimmed.
    await expect(
      run("action-log", "list", "kn-1", "--keyword", `  ${"x".repeat(128)}  `),
    ).rejects.toThrow(/at most 128/);
    await expect(
      run("action-log", "get", "kn-1", "log-1", "--results-limit", "1001"),
    ).rejects.toThrow("--results-limit must be an integer from 1 to 1000");
    await expect(
      run(
        "action-log",
        "get",
        "kn-1",
        "log-1",
        "--results-offset",
        "9950",
        "--results-limit",
        "100",
      ),
    ).rejects.toThrow("must not exceed 10000");
    // The backend's results_limit default of 100 counts when the flag is left out.
    await expect(
      run("action-log", "get", "kn-1", "log-1", "--results-offset", "9901"),
    ).rejects.toThrow("must not exceed 10000");
    await expect(
      run("action-log", "get", "kn-1", "log-1", "--results-offset", "-1"),
    ).rejects.toThrow();
    expect(kn.actionLogs).not.toHaveBeenCalled();
    expect(kn.actionLog).not.toHaveBeenCalled();
    await run(
      "action-log",
      "get",
      "kn-1",
      "log-1",
      "--results-offset",
      "9000",
      "--results-limit",
      "1000",
    );
    expect(kn.actionLog).toHaveBeenCalledWith(
      "kn-1",
      "log-1",
      expect.objectContaining({ resultsOffset: 9000, resultsLimit: 1000 }),
    );
  });

  it("capability list --metadata-type is limited to openapi | function", async () => {
    await expect(run("capability", "list", "kn-1", "--metadata-type", "mcp")).rejects.toThrow(
      "--metadata-type must be one of",
    );
    expect(kn.capabilityList).not.toHaveBeenCalled();
    await run("capability", "list", "kn-1", "--metadata-type", "openapi");
    expect(kn.capabilityList).toHaveBeenCalledWith(
      "kn-1",
      expect.objectContaining({ metadataType: "openapi" }),
    );
  });

  it("action-log cancel passes --reason", async () => {
    await run("action-log", "cancel", "kn-1", "log-1", "--reason", "stuck");
    expect(kn.cancelActionLog).toHaveBeenCalledWith("kn-1", "log-1", { reason: "stuck" });
  });
});

describe("warnUnboundCapabilities", () => {
  it("does not throw on a skipped list holding non-objects, or on no report at all", () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(() =>
      warnUnboundCapabilities(
        { capabilities: { skipped: [null, 3] } },
        { declared: 0, skipped: [] },
      ),
    ).not.toThrow();
    expect(() => warnUnboundCapabilities(null, { declared: 0, skipped: [] })).not.toThrow();
    expect(() =>
      warnUnboundCapabilities({ capabilities: null }, { declared: 0, skipped: [] }),
    ).not.toThrow();
    expect(write).not.toHaveBeenCalled();
  });
});
