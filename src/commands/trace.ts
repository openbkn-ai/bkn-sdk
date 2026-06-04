/** `openbkn trace …` — trace data (search/get) + diagnose + eval-set. */
import { readFileSync, writeFileSync } from "node:fs";
import { Command } from "commander";
import { group } from "../help/grouped-help.js";
import { renderReportMarkdown } from "../trace-ai/diagnose.js";
import { printJson } from "../utils/output.js";
import { clientFrom, outputOptions, readBody } from "./_shared.js";

function notImplemented(path: string): () => never {
  return () => {
    throw new Error(
      `\`openbkn trace ${path}\` is not implemented yet (rule engine + LLM-as-judge; see tech-debt).`,
    );
  };
}

export function traceCommand(): Command {
  const cmd = new Command("trace").description(
    "Trace AI — fetch trace spans; diagnose/eval-set (rule engine) pending",
  );

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

  // schema validate (rule / eval-case YAML zod check) — still pending.
  cmd
    .command("schema")
    .description("schema (pending)")
    .allowUnknownOption()
    .action(notImplemented("schema"));

  return group(cmd, "TRACE AI");
}
