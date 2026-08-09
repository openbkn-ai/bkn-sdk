import { describe, expect, it } from "vitest";
import { traceCommand } from "../../src/commands/trace.js";

describe("trace lifecycle CLI contract", () => {
  it("exposes lifecycle and receipt commands without Community business-explanation commands", () => {
    const command = traceCommand();
    const names = command.commands.map((child) => child.name());

    expect(names).toEqual(
      expect.arrayContaining(["conversations", "interactions", "operations", "receipts"]),
    );
    expect(names).not.toEqual(
      expect.arrayContaining(["evidence-chain", "business-graph", "snapshot-preview", "evidence"]),
    );
    expect(
      command.commands
        .find((child) => child.name() === "conversations")
        ?.commands.map((c) => c.name()),
    ).toEqual(
      expect.arrayContaining([
        "list",
        "ensure-current",
        "create-new-generation",
        "resume",
        "get",
        "close",
      ]),
    );
    expect(
      command.commands
        .find((child) => child.name() === "operations")
        ?.commands.map((c) => c.name()),
    ).toEqual(expect.arrayContaining(["get", "attempt", "retry"]));
    const retry = command.commands
      .find((child) => child.name() === "operations")
      ?.commands.find((child) => child.name() === "retry");
    expect(retry?.options.map((option) => option.long)).toEqual(["--body-file"]);
    expect(retry?.options.map((option) => option.long)).not.toContain("--lease-token");
    expect(
      command.commands
        .find((child) => child.name() === "interactions")
        ?.commands.map((c) => c.name()),
    ).toEqual(
      expect.arrayContaining([
        "start",
        "get",
        "operations",
        "complete",
        "fail",
        "cancel",
        "handoff",
      ]),
    );
    const start = command.commands
      .find((child) => child.name() === "interactions")
      ?.commands.find((child) => child.name() === "start");
    expect(start?.options.map((option) => option.long)).toEqual([
      "--idempotency-key",
      "--agent-name",
      "--lease-seconds",
    ]);
    for (const name of ["complete", "fail", "cancel", "handoff"]) {
      const terminal = command.commands
        .find((child) => child.name() === "interactions")
        ?.commands.find((child) => child.name() === name);
      expect(terminal?.options.map((option) => option.long)).toEqual(["--body-file"]);
    }
    expect(
      command.commands.find((child) => child.name() === "receipts")?.commands.map((c) => c.name()),
    ).toEqual(["get"]);
  });
});
