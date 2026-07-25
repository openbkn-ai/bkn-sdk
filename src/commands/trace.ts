// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** `openbkn trace …` — trace data (search/get) + diagnose + eval-set. */
import { readFileSync, writeFileSync } from "node:fs";
import { Command } from "commander";
import { renderReportMarkdown } from "../bkn-trace/diagnose.js";
import { validateFixturePath } from "../bkn-trace/fixture-validate.js";
import { validateSchemaFile } from "../bkn-trace/schema-validate.js";
import { group } from "../help/grouped-help.js";
import { InputError } from "../utils/errors.js";
import { printJson } from "../utils/output.js";
import { clientFrom, outputOptions, readBody } from "./_shared.js";

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

  cmd
    .command("evidence-chain [trace-id]")
    .description("Fetch BKN Trace evidence chain by trace id or --request-id")
    .option("--request-id <id>", "BKN request id scope")
    .option("--limit <n>", "maximum evidence trace batches", (v) => Number.parseInt(v, 10))
    .action(async (traceId: string | undefined, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).trace.evidenceChain(traceScope(traceId, opts.requestId), {
          limit: opts.limit,
        }),
        outputOptions(cmd),
      );
    });

  cmd
    .command("business-graph [trace-id]")
    .description("Fetch BKN Trace business semantic graph by trace id or --request-id")
    .option("--request-id <id>", "BKN request id scope")
    .option("--limit <n>", "maximum evidence trace batches", (v) => Number.parseInt(v, 10))
    .action(async (traceId: string | undefined, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).trace.businessGraph(traceScope(traceId, opts.requestId), {
          limit: opts.limit,
        }),
        outputOptions(cmd),
      );
    });

  cmd
    .command("snapshot-preview [trace-id]")
    .description("Fetch metadata-only evidence snapshot preview by trace id or --request-id")
    .option("--request-id <id>", "BKN request id scope")
    .option("--limit <n>", "maximum evidence trace batches", (v) => Number.parseInt(v, 10))
    .action(async (traceId: string | undefined, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).trace.snapshotPreview(traceScope(traceId, opts.requestId), {
          limit: opts.limit,
        }),
        outputOptions(cmd),
      );
    });

  cmd
    .command("get <conversation-id>")
    .description("Fetch all trace spans for a conversation")
    .option("--max-spans <n>", "max spans", (v) => Number.parseInt(v, 10))
    .action(async (conversationId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).trace.spans(conversationId, { maxSpans: opts.maxSpans }),
        outputOptions(cmd),
      );
    });

  cmd
    .command("search")
    .description("Raw trace search (--body / --body-file OpenSearch JSON)")
    .option("--body <json>", "search body JSON")
    .option("--body-file <path>", "read search body JSON from a file")
    .action(async (opts, cmd: Command) => {
      printJson(await clientFrom(cmd).trace.search(readBody(opts)), outputOptions(cmd));
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

  const evidence = cmd
    .command("evidence")
    .description("Submit BKN Trace 2.x business evidence events");
  evidence
    .command("emit <file>")
    .description("Submit a BKN Trace 2.0/2.1 event batch JSON file")
    .action(async (file: string, _opts, cmd: Command) => {
      const body = JSON.parse(readFileSync(file, "utf8"));
      printJson(await clientFrom(cmd).trace.emitEvidenceEvents(body), outputOptions(cmd));
    });

  return group(cmd, "TRACE AI");
}

function traceScope(traceId: string | undefined, requestId: string | undefined) {
  if (traceId && requestId) {
    throw new InputError("Provide either trace id or --request-id, not both.");
  }
  if (requestId) return { requestId };
  if (traceId) return traceId;
  throw new InputError("Provide a trace id or --request-id.");
}
