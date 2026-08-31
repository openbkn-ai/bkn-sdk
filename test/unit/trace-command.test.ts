import { describe, expect, it } from "vitest";
import type { OperationReceipt } from "../../src/api/trace-lifecycle.js";
import { renderTechnicalTraceDetail, traceCommand } from "../../src/commands/trace.js";

function receipt(status: "completed" | "failed"): OperationReceipt {
  return {
    receipt_id: `receipt-${status}`,
    schema_version: "3.0.0",
    owner: {
      application_principal_id: "app-1",
      effective_subject_type: "user",
      effective_subject_id: "user-1",
    },
    conversation_id: "conv-1",
    interaction_id: "int-1",
    operation_id: `op-${status}`,
    attempt: 1,
    operation_key: `op-${status}`,
    tool_name: "run_sql",
    receipt_status: status,
    evidence_durability: "durable",
    required: true,
    request_id: "req-1",
    trace_id: "trace-1",
    causation_event_ids: [],
    observed_evidence_refs: [],
    business_refs: [],
    artifact_refs: [],
    partial_reasons: [],
    row_version: 1,
    issued_at: "2026-08-09T10:00:00Z",
  };
}

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

  it("keeps get conversation-scoped and uses detail for one technical trace", () => {
    const command = traceCommand();
    const search = command.commands.find((child) => child.name() === "search");
    const get = command.commands.find((child) => child.name() === "get");
    const detail = command.commands.find((child) => child.name() === "detail");

    expect(search?.options.map((option) => option.long)).toEqual([
      "--limit",
      "--cursor",
      "--from",
      "--to",
      "--status",
      "--service",
      "--tool",
      "--trace-id",
      "--error-keyword",
      "--conversation-id",
      "--interaction-id",
    ]);
    expect(get?.registeredArguments[0]?.name()).toBe("conversation-id");
    expect(detail?.registeredArguments[0]?.name()).toBe("trace-id");
  });

  it("renders operation input, output and error without business interpretation", () => {
    const text = renderTechnicalTraceDetail({
      summary: {
        trace_id: "trace-1",
        request_id: "req-1",
        question_preview: "对比两款产品的 BOM 物料差异。",
        result_preview: "返回 1 条记录。",
        root_service: "context-loader",
        status: "failed",
        span_count: 0,
      },
      operations: [
        {
          state: "completed",
          fact: {
            operation_id: "op-success",
            attempt: 1,
            conversation_id: "conv-1",
            interaction_id: "int-1",
            tool_name: "run_sql",
            protocol: "mcp",
            source_module: "context-loader",
            input: { mode: "inline", media_type: "application/json", inline: { sql: "SELECT 1" } },
            output: { mode: "inline", media_type: "application/json", inline: { row_count: 1 } },
            trace_id: "trace-1",
            started_at: "2026-08-09T10:00:00Z",
            status: "completed",
            retryable: false,
          },
          receipt: receipt("completed"),
        },
        {
          state: "failed",
          fact: {
            operation_id: "op-failed",
            attempt: 1,
            conversation_id: "conv-1",
            interaction_id: "int-1",
            tool_name: "search_schema",
            protocol: "mcp",
            source_module: "context-loader",
            input: { mode: "inline", media_type: "application/json", inline: { query: "物料" } },
            error: { mode: "inline", media_type: "application/json", inline: { code: "TIMEOUT" } },
            trace_id: "trace-1",
            started_at: "2026-08-09T10:00:01Z",
            status: "failed",
            retryable: true,
          },
          receipt: receipt("failed"),
        },
      ],
      partial: false,
      partial_reasons: [],
    });

    expect(text).toContain('Input: {"sql":"SELECT 1"}');
    expect(text).toContain('Output: {"row_count":1}');
    expect(text).toContain('Error: {"code":"TIMEOUT"}');
    expect(text).toContain("Question: 对比两款产品的 BOM 物料差异。");
    expect(text).toContain("Result: 返回 1 条记录。");
    expect(text).toContain("Service: context-loader");
    expect(text).not.toContain("业务依据");
  });
});
