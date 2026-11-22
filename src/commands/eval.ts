import { Command } from "commander";
import type { EvalOperationInput, EvalQuery } from "../api/evals.js";
import { group, groupChildren, guide } from "../help/grouped-help.js";
import { InputError } from "../utils/errors.js";
import { printJson } from "../utils/output.js";
import { clientFrom, oneOf, outputOptions, positiveInt, readBody } from "./_shared.js";

function networkCommand(parent: Command, name: string, summary: string): Command {
  return parent.command(name).description(summary).argument("<kn-id>", "knowledge network ID");
}

function pageLimit(command: Command): Command {
  return command.option(
    "--limit <n>",
    "maximum entries (default: 30)",
    positiveInt("--limit", 100),
    30,
  );
}

function offset(value: string): number {
  return /^0+$/.test(value) ? 0 : positiveInt("--offset", 100000)(value);
}

type BodyOperation =
  | "previewEvalRuleApplication"
  | "saveEvalRuleApplication"
  | "createEvalSuite"
  | "previewEvalRunSelection"
  | "createEvalRun";

function bodyCommand<Operation extends BodyOperation>(
  parent: Command,
  name: string,
  summary: string,
  operation: Operation,
): void {
  networkCommand(parent, name, summary)
    .option("--body <json>", "request JSON object")
    .option("--body-file <path>", "read the request JSON object from a file")
    .action(
      async (knId: string, options: { body?: string; bodyFile?: string }, command: Command) => {
        if (options.body !== undefined && options.bodyFile !== undefined) {
          throw new InputError("--body and --body-file cannot be combined.");
        }
        const body = readBody(options);
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          throw new InputError("Eval request body must be a JSON object.");
        }
        const result = await clientFrom(command)
          .evals.forNetwork(knId)
          .request(operation, { body } as EvalOperationInput<Operation>);
        printJson(result, outputOptions(command));
      },
    );
}

export function evalCommand(): Command {
  const command = new Command("eval").description(
    "Evaluate knowledge-network resources with rules and Suites",
  );
  const kinds = [
    "objectType",
    "relationType",
    "action",
    "metric",
    "function",
    "api",
    "mcp",
    "skill",
  ] as const;

  networkCommand(
    command,
    "capabilities",
    "Check access and enabled Eval management features",
  ).action(async (knId: string, _options, leaf: Command) => {
    const result = await clientFrom(leaf).evals.forNetwork(knId).request("getEvalCapabilities", {});
    printJson(result, outputOptions(leaf));
  });

  networkCommand(
    command,
    "rules",
    "Read current rule definitions and applicability settings",
  ).action(async (knId: string, _options, leaf: Command) => {
    const result = await clientFrom(leaf)
      .evals.forNetwork(knId)
      .request("getEvalTemplateConfig", {});
    printJson(result, outputOptions(leaf));
  });

  pageLimit(
    networkCommand(command, "resources", "List resources available for rule-based evaluation"),
  )
    .option("--kind <kind>", "filter by resource kind", oneOf("--kind", kinds))
    .option("--q <text>", "search resource names")
    .option("--offset <n>", "skip this many entries", offset)
    .action(async (knId: string, query: EvalQuery, leaf: Command) => {
      const result = await clientFrom(leaf)
        .evals.forNetwork(knId)
        .request("listEvalCaseResources", { query });
      printJson(result, outputOptions(leaf));
    });

  bodyCommand(
    command,
    "preview-rules",
    "Preview rule matches for selected resources",
    "previewEvalRuleApplication",
  );
  bodyCommand(
    command,
    "save-rules",
    "Generate and save cases for selected resources and rules",
    "saveEvalRuleApplication",
  );
  bodyCommand(
    command,
    "create-suite",
    "Create a versioned Suite from saved case IDs",
    "createEvalSuite",
  );
  bodyCommand(
    command,
    "preview-run",
    "Check which cases in a Suite version are runnable",
    "previewEvalRunSelection",
  );
  bodyCommand(
    command,
    "start-run",
    "Start an evaluation Run with an explicit scope and idempotency key",
    "createEvalRun",
  );

  pageLimit(
    networkCommand(command, "list-runs", "List recent Runs and their outcome counts"),
  ).action(async (knId: string, query: EvalQuery, leaf: Command) => {
    const result = await clientFrom(leaf)
      .evals.forNetwork(knId)
      .request("listRecentEvalRuns", { query });
    printJson(result, outputOptions(leaf));
  });

  networkCommand(command, "get-run", "Read Run status and outcome counts")
    .argument("<run-id>", "Run returned by start-run or list-runs")
    .action(async (knId: string, runId: string, _options, leaf: Command) => {
      const result = await clientFrom(leaf)
        .evals.forNetwork(knId)
        .request("getEvalRun", { path: { run_id: runId } });
      printJson(result, outputOptions(leaf));
    });

  pageLimit(networkCommand(command, "run-cases", "List case outcomes for a Run"))
    .argument("<run-id>", "Run returned by start-run or list-runs")
    .option("--cursor <cursor>", "continue from the previous page")
    .action(async (knId: string, runId: string, query: EvalQuery, leaf: Command) => {
      const result = await clientFrom(leaf)
        .evals.forNetwork(knId)
        .request("listEvalCaseRuns", {
          path: { run_id: runId },
          query,
        });
      printJson(result, outputOptions(leaf));
    });

  groupChildren(command, {
    READ: [
      "capabilities",
      "rules",
      "resources",
      "preview-rules",
      "preview-run",
      "list-runs",
      "get-run",
      "run-cases",
    ],
    WRITE: ["save-rules", "create-suite"],
    RUN: ["start-run"],
  });
  guide(
    command,
    `WORKFLOW
  Check capabilities, then list resources and rules. Preview selected resources
  with preview-rules before saving cases with save-rules. Create a Suite from
  those case IDs, then use preview-run on the returned Suite ID and version.
  Start the Run only after reviewing selected and blocked cases. Read progress
  with get-run and results with run-cases. This needs a signed-in Eval user.`,
  );
  return group(command, "DATA & KNOWLEDGE");
}
