// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** `openbkn trace …` — trace data (search/get) + diagnose + eval-set. */
import { readFileSync, writeFileSync } from "node:fs";
import { Command } from "commander";
import type {
  InteractionCompletionInput,
  RetryOperationAttemptInput,
} from "../api/trace-lifecycle.js";
import type { PayloadEnvelope } from "../api/trace-lifecycle.js";
import type { TechnicalTraceDetail } from "../api/trace.js";
import { renderReportMarkdown } from "../bkn-trace/diagnose.js";
import { validateFixturePath } from "../bkn-trace/fixture-validate.js";
import { validateSchemaFile } from "../bkn-trace/schema-validate.js";
import { group } from "../help/grouped-help.js";
import { InputError } from "../utils/errors.js";
import { printJson } from "../utils/output.js";
import { clientFrom, outputOptions, readBody } from "./_shared.js";

function renderPayload(payload: PayloadEnvelope | undefined): string {
  if (!payload) return "-";
  if (payload.mode === "inline") return JSON.stringify(payload.inline);
  if (payload.mode === "referenced") return `[referenced] ${payload.ref ?? "-"}`;
  return `[omitted] ${payload.omitted_reason ?? "unknown"}`;
}

export function renderTechnicalTraceDetail(detail: TechnicalTraceDetail): string {
  const lines = [
    `Trace: ${detail.summary.trace_id}`,
    `Status: ${detail.summary.status}`,
    `Request: ${detail.summary.request_id || "-"}`,
    `Question: ${detail.summary.question_preview || "-"}`,
    `Result: ${detail.summary.result_preview || "-"}`,
    `Service: ${detail.summary.root_service || "-"}`,
    `Spans: ${detail.graph?.data.nodes.length ?? 0}`,
  ];
  if (detail.partial) {
    lines.push(`Partial: ${(detail.partial_reasons ?? []).join(", ") || "yes"}`);
  }
  for (const operation of detail.operations) {
    lines.push(
      "",
      `${operation.fact.tool_name} · ${operation.fact.operation_id} · attempt ${operation.fact.attempt} · ${operation.state}`,
      `Source: ${operation.fact.protocol}/${operation.fact.source_module}`,
      `Input: ${renderPayload(operation.fact.input)}`,
    );
    if (operation.fact.output) lines.push(`Output: ${renderPayload(operation.fact.output)}`);
    if (operation.fact.error) lines.push(`Error: ${renderPayload(operation.fact.error)}`);
    if (operation.partial_reasons?.length) {
      lines.push(`Partial: ${operation.partial_reasons.join(", ")}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function traceCommand(): Command {
  const cmd = new Command("trace").description(
    "BKN Trace — fetch spans, diagnose (symbolic + LLM rubric), scan, eval-set, schema validate",
  );

  cmd
    .command("graph <trace-id>")
    .description("Fetch normalized trace graph by trace id")
    .action(async (traceId: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).trace.graph(traceId), outputOptions(cmd));
    });

  const conversations = cmd.command("conversations").description("Manage Trace conversations");
  conversations
    .command("list")
    .description("List conversations in the authorized owner scope")
    .option("--limit <n>", "page size, 1..100", (value) => Number.parseInt(value, 10))
    .action(async (opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).trace.lifecycle.listConversations({ limit: opts.limit }),
        outputOptions(cmd),
      );
    });
  conversations
    .command("ensure-current <external-conversation-key>")
    .description("Ensure the current Core-owned conversation generation")
    .option("--one-shot", "create a one-shot conversation")
    .option("--idempotency-key <key>", "stable idempotency key")
    .action(async (externalConversationKey: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).trace.lifecycle.ensureConversation({
          external_conversation_key: externalConversationKey,
          idempotency_key: opts.idempotencyKey,
          one_shot: Boolean(opts.oneShot),
        }),
        outputOptions(cmd),
      );
    });
  conversations
    .command("create-new-generation <external-conversation-key>")
    .description("Create the next Core-owned conversation generation")
    .requiredOption("--idempotency-key <key>", "stable idempotency key")
    .action(async (externalConversationKey: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).trace.lifecycle.createNewConversationGeneration({
          external_conversation_key: externalConversationKey,
          idempotency_key: opts.idempotencyKey,
        }),
        outputOptions(cmd),
      );
    });
  conversations
    .command("resume <conversation-id>")
    .description("Resume an existing authorized conversation")
    .action(async (conversationId: string, _opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).trace.lifecycle.resumeConversation({
          conversation_id: conversationId,
        }),
        outputOptions(cmd),
      );
    });
  conversations
    .command("get <conversation-id>")
    .description("Get an authorized conversation")
    .action(async (conversationId: string, _opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).trace.lifecycle.getConversation(conversationId),
        outputOptions(cmd),
      );
    });
  conversations
    .command("close <conversation-id>")
    .description("Close an active conversation")
    .option("--idempotency-key <key>", "stable idempotency key")
    .action(async (conversationId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).trace.lifecycle.closeConversation(conversationId, {
          idempotency_key: opts.idempotencyKey,
        }),
        outputOptions(cmd),
      );
    });

  const interactions = cmd.command("interactions").description("Inspect Trace interactions");
  interactions
    .command("start <conversation-id>")
    .description("Start one managed interaction")
    .requiredOption("--idempotency-key <key>", "stable idempotency key")
    .option("--agent-name <name>", "conversation-level Agent display name")
    .option("--lease-seconds <n>", "interaction lease duration", (value) =>
      Number.parseInt(value, 10),
    )
    .action(async (conversationId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).trace.lifecycle.startInteraction(conversationId, {
          idempotency_key: opts.idempotencyKey,
          agent_name: opts.agentName,
          lease_seconds: opts.leaseSeconds,
        }),
        outputOptions(cmd),
      );
    });
  interactions
    .command("get <interaction-id>")
    .description("Get an authorized interaction")
    .action(async (interactionId: string, _opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).trace.lifecycle.getInteraction(interactionId),
        outputOptions(cmd),
      );
    });
  interactions
    .command("operations <interaction-id>")
    .description("List the exact Operation call facts for one interaction")
    .action(async (interactionId: string, _opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).trace.lifecycle.listInteractionOperations(interactionId),
        outputOptions(cmd),
      );
    });
  for (const action of ["complete", "fail", "cancel", "handoff"] as const) {
    interactions
      .command(`${action} <interaction-id>`)
      .description(`${action} a managed interaction using a 3.0 completion manifest`)
      .requiredOption("--body-file <path>", "read completion manifest JSON from a protected file")
      .action(async (interactionId: string, opts, cmd: Command) => {
        const input = readBody(opts) as InteractionCompletionInput;
        const lifecycle = clientFrom(cmd).trace.lifecycle;
        const terminal = {
          complete: lifecycle.completeInteraction,
          fail: lifecycle.failInteraction,
          cancel: lifecycle.cancelInteraction,
          handoff: lifecycle.handoffInteraction,
        }[action];
        printJson(await terminal(interactionId, input), outputOptions(cmd));
      });
  }

  const operations = cmd.command("operations").description("Inspect and retry operations");
  operations
    .command("get <operation-id>")
    .description("Get an authorized operation")
    .action(async (operationId: string, _opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).trace.lifecycle.getOperation(operationId),
        outputOptions(cmd),
      );
    });
  operations
    .command("attempt <operation-id> <attempt>")
    .description("Get one exact Operation attempt call fact")
    .action(async (operationId: string, attempt: string, _opts, cmd: Command) => {
      if (!/^[1-9]\d*$/.test(attempt)) {
        throw new InputError("attempt must be a positive integer");
      }
      const ordinal = Number.parseInt(attempt, 10);
      printJson(
        await clientFrom(cmd).trace.lifecycle.getOperationAttempt(operationId, ordinal),
        outputOptions(cmd),
      );
    });
  operations
    .command("retry <operation-id>")
    .description("Create the next retry attempt for an eligible failed operation")
    .requiredOption("--body-file <path>", "read retry request JSON from a protected file")
    .action(async (operationId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).trace.lifecycle.retryOperationAttempt(
          operationId,
          readBody(opts) as RetryOperationAttemptInput,
        ),
        outputOptions(cmd),
      );
    });

  const receipts = cmd.command("receipts").description("Inspect durable operation receipts");
  receipts
    .command("get <receipt-id>")
    .description("Get an authorized operation receipt")
    .action(async (receiptId: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).trace.lifecycle.getReceipt(receiptId), outputOptions(cmd));
    });

  cmd
    .command("get <trace-id>")
    .description("Get one typed technical trace with Span and Operation facts")
    .action(async (traceId: string, _opts, cmd: Command) => {
      const detail = await clientFrom(cmd).trace.get(traceId);
      const output = outputOptions(cmd);
      if (output.json || output.compact) printJson(detail, output);
      else process.stdout.write(renderTechnicalTraceDetail(detail));
    });

  cmd
    .command("spans <conversation-id>")
    .description("Fetch normalized spans for a conversation")
    .option("--max-spans <n>", "max spans", (v) => Number.parseInt(v, 10))
    .action(async (conversationId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).trace.spans(conversationId, { maxSpans: opts.maxSpans }),
        outputOptions(cmd),
      );
    });

  cmd
    .command("search")
    .description("List authorized technical traces")
    .option("--limit <n>", "page size, 1..200", (value) => Number.parseInt(value, 10))
    .option("--cursor <cursor>", "opaque pagination cursor")
    .option("--from <time>", "started at or after this RFC3339 timestamp")
    .option("--to <time>", "started at or before this RFC3339 timestamp")
    .option("--status <status>", "execution status")
    .option("--service <service>", "exact producing service")
    .option("--tool <tool>", "exact root tool")
    .option("--trace-id <id>", "exact Trace ID")
    .option("--error-keyword <text>", "case-insensitive error text")
    .action(async (opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).trace.search({
          limit: opts.limit,
          cursor: opts.cursor,
          from: opts.from,
          to: opts.to,
          status: opts.status,
          service: opts.service,
          tool: opts.tool,
          traceId: opts.traceId,
          errorKeyword: opts.errorKeyword,
        }),
        outputOptions(cmd),
      );
    });

  cmd
    .command("diagnose <conversation-id>")
    .description("Diagnose a conversation's trace (symbolic rules; --llm adds rubric judging)")
    .option("--llm", "also run LLM-judged rubric rules via the local `claude` CLI")
    .action(async (conversationId: string, opts, cmd: Command) => {
      const report = await clientFrom(cmd).trace.diagnose(conversationId, {
        llm: Boolean(opts.llm),
      });
      const out = outputOptions(cmd);
      if (out.json) printJson(report, out);
      else console.log(renderReportMarkdown(report));
    });

  cmd
    .command("scan <conversation-ids>")
    .description("Batch-diagnose several conversations (comma-joined) + aggregate findings")
    .option("--llm", "hybrid mode (rubric + synthesizer) per trace via local `claude`")
    .action(async (ids: string, opts, cmd: Command) => {
      const list = ids
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      printJson(
        await clientFrom(cmd).trace.scan(list, { llm: Boolean(opts.llm) }),
        outputOptions(cmd),
      );
    });

  const evalSet = cmd.command("eval-set").description("Build + run trace eval sets");
  evalSet
    .command("build <queries-file>")
    .description("Build eval cases from a queries JSON file")
    .option("--out <file>", "write the cases JSON here (default: stdout)")
    .action(async (queriesFile: string, opts, cmd: Command) => {
      const raw = JSON.parse(readFileSync(queriesFile, "utf8"));
      const cases = clientFrom(cmd).trace.evalSetBuild(raw);
      if (opts.out) {
        writeFileSync(opts.out, JSON.stringify({ cases }, null, 2));
        printJson({ out: opts.out, cases: cases.length }, outputOptions(cmd));
      } else {
        printJson({ cases }, outputOptions(cmd));
      }
    });
  evalSet
    .command("test <cases-file>")
    .description("Run an eval set against an agent (--llm enables semantic_match)")
    .requiredOption("--agent <id>", "agent id to run the queries against")
    .option("--version <v>", "agent version", "v0")
    .option("--llm", "enable semantic_match assertions via the local `claude` CLI")
    .action(async (casesFile: string, opts, cmd: Command) => {
      const raw = JSON.parse(readFileSync(casesFile, "utf8"));
      const cases = clientFrom(cmd).trace.evalSetBuild(raw);
      const result = await clientFrom(cmd).trace.evalSetTest(opts.agent, cases, {
        version: opts.version,
        llm: Boolean(opts.llm),
      });
      printJson(result, outputOptions(cmd));
      if (result.failed > 0) process.exitCode = 1;
    });

  const schema = cmd.command("schema").description("Validate eval-set / diagnosis-rule files");
  schema
    .command("validate <file>")
    .description("Validate an eval-set or diagnosis-rule file (JSON/YAML) against its schema")
    .option("--kind <k>", "force schema kind: eval-set | rule (default: auto-detect)")
    .action(async (file: string, opts, cmd: Command) => {
      const result = validateSchemaFile(file, opts.kind);
      printJson(result, outputOptions(cmd));
      if (!result.valid) process.exitCode = 1;
    });

  cmd
    .command("validate-fixture <path>")
    .description("Validate BKN Trace 1.0/2.0/2.1 fixture JSON files")
    .action(async (path: string, _opts, cmd: Command) => {
      const result = validateFixturePath(path);
      printJson(result, outputOptions(cmd));
      if (!result.ok) process.exitCode = 1;
    });

  return group(cmd, "TRACE AI");
}
