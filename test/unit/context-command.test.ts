// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

const { managedToolCall, searchSchema } = vi.hoisted(() => ({
  managedToolCall: vi.fn(),
  searchSchema: vi.fn(),
}));

vi.mock("../../src/commands/_shared.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/commands/_shared.js")>();
  return {
    ...actual,
    clientFrom: vi.fn(() => ({ context: { managedToolCall, searchSchema } })),
  };
});

import { contextCommand } from "../../src/commands/context.js";

function program(json = false): Command {
  return new Command("openbkn")
    .exitOverride()
    .option("--json")
    .option("--compact")
    .addCommand(contextCommand());
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("openbkn context tool-call receipt output", () => {
  it("rejects --receipt without machine-readable output before calling the deploy", async () => {
    await expect(
      program().parseAsync([
        "node",
        "openbkn",
        "context",
        "tool-call",
        "kn-a",
        "search_schema",
        "--receipt",
      ]),
    ).rejects.toThrow("--receipt requires --json or --compact");
  });

  it("rejects --receipt with --schema", async () => {
    await expect(
      program(true).parseAsync([
        "node",
        "openbkn",
        "--json",
        "context",
        "tool-call",
        "kn-a",
        "search_schema",
        "--receipt",
        "--schema",
      ]),
    ).rejects.toThrow("--receipt cannot be combined with --schema");
  });

  it("returns value and the validated receipt in the explicit JSON envelope", async () => {
    managedToolCall.mockResolvedValue({
      value: { rows: [{ id: "row-1" }] },
      receipt: {
        receipt_id: "rec-1",
        conversation_id: "conv-1",
        interaction_id: "int-1",
        operation_id: "op-1",
        receipt_status: "completed",
      },
    });
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await program(true).parseAsync([
      "node",
      "openbkn",
      "--json",
      "context",
      "tool-call",
      "kn-a",
      "search_schema",
      "--args",
      '{"query":"supplier"}',
      "--receipt",
    ]);

    expect(managedToolCall).toHaveBeenCalledWith("kn-a", "search_schema", { query: "supplier" });
    expect(write).toHaveBeenCalledWith(
      `${JSON.stringify(
        {
          value: { rows: [{ id: "row-1" }] },
          bkn_receipt: {
            receipt_id: "rec-1",
            conversation_id: "conv-1",
            interaction_id: "int-1",
            operation_id: "op-1",
            receipt_status: "completed",
          },
        },
        null,
        2,
      )}\n`,
    );
  });

  it("keeps the receipt envelope machine-readable with --compact", async () => {
    managedToolCall.mockResolvedValue({
      value: null,
      receipt: {
        receipt_id: "rec-2",
        conversation_id: "conv-2",
        interaction_id: "int-2",
        operation_id: "op-2",
        receipt_status: "pending",
      },
    });
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await program().parseAsync([
      "node",
      "openbkn",
      "--compact",
      "context",
      "tool-call",
      "kn-a",
      "search_schema",
      "--receipt",
    ]);

    expect(write).toHaveBeenCalledWith(
      `${JSON.stringify({
        value: null,
        bkn_receipt: {
          receipt_id: "rec-2",
          conversation_id: "conv-2",
          interaction_id: "int-2",
          operation_id: "op-2",
          receipt_status: "pending",
        },
      })}\n`,
    );
  });

  it("reads --args-file and lets explicit --arg override it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bkn-context-args-"));
    tempDirs.push(dir);
    const path = join(dir, "args.json");
    writeFileSync(path, '{"query":"supplier","limit":5}');
    managedToolCall.mockResolvedValue({ value: null, receipt: { receipt_id: "rec-3" } });
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await program(true).parseAsync([
      "node",
      "openbkn",
      "--json",
      "context",
      "tool-call",
      "kn-a",
      "search_schema",
      "--args-file",
      path,
      "--arg",
      "limit=10",
      "--receipt",
    ]);

    expect(managedToolCall).toHaveBeenCalledWith("kn-a", "search_schema", {
      query: "supplier",
      limit: 10,
    });
  });
});

describe("openbkn context search-schema scope", () => {
  const run = async (...args: string[]) => {
    searchSchema.mockResolvedValue({ object_types: [] });
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await program(true).parseAsync([
      "node",
      "openbkn",
      "--json",
      "context",
      "search-schema",
      ...args,
    ]);
    return searchSchema.mock.calls.at(-1);
  };

  afterEach(() => searchSchema.mockReset());

  it("maps --concept-groups and --only onto the SearchSchemaScope object", async () => {
    const call = await run(
      "kn-a",
      "churn",
      "--concept-groups",
      "cg_sales, cg_service",
      "--only",
      "object,relation",
      "--max",
      "5",
    );
    expect(call).toEqual([
      "kn-a",
      "churn",
      {
        searchScope: {
          conceptGroups: ["cg_sales", "cg_service"],
          includeObjectTypes: true,
          includeRelationTypes: true,
          includeActionTypes: false,
          includeMetricTypes: false,
        },
        maxConcepts: 5,
        schemaBrief: undefined,
        enableRerank: undefined,
        rerankModel: undefined,
        includeColumns: undefined,
      },
    ]);
  });

  it("keeps --scope as an alias of --only", async () => {
    const call = await run("kn-a", "q", "--scope", "metric");
    expect(call?.[2].searchScope).toEqual({
      includeObjectTypes: false,
      includeRelationTypes: false,
      includeActionTypes: false,
      includeMetricTypes: true,
    });
  });

  it("forwards the documented tuning flags and leaves unset ones undefined", async () => {
    const call = await run(
      "kn-a",
      "q",
      "--no-schema-brief",
      "--include-columns",
      "--no-rerank",
      "--rerank-model",
      "bge-reranker",
    );
    expect(call?.[2]).toMatchObject({
      searchScope: undefined,
      schemaBrief: false,
      includeColumns: true,
      enableRerank: false,
      rerankModel: "bge-reranker",
    });
  });

  it("refuses an unknown concept kind before calling the deploy", async () => {
    await expect(run("kn-a", "q", "--only", "object,table")).rejects.toThrow(
      "Unknown concept kind: table",
    );
    expect(searchSchema).not.toHaveBeenCalled();
  });
});
