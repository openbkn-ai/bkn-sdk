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
    conceptGroups: ok(),
    actionSchedules: ok(),
    actionTypeQuery: ok(),
    get: ok(),
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
