// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

const { managedToolCall } = vi.hoisted(() => ({
  managedToolCall: vi.fn(),
}));

vi.mock("../../src/commands/_shared.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/commands/_shared.js")>();
  return {
    ...actual,
    clientFrom: vi.fn(() => ({ context: { managedToolCall } })),
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
