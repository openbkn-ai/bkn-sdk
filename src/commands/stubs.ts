/**
 * Placeholder commands so `openbkn --help` shows the full grouped command tree
 * while real handlers are filled in incrementally. Each leaf throws until
 * implemented. Subcommand names mirror the legacy CLIs (see
 * test/equivalence/command-map.md) so the tree shape is right from day one.
 */
import { Command } from "commander";
import { group } from "../help/grouped-help.js";

function notImplemented(path: string): () => never {
  return () => {
    throw new Error(`\`openbkn ${path}\` is not implemented yet.`);
  };
}

/** Build a group command with stubbed subcommands (names only). */
function stub(name: string, description: string, groupName: string, subs: string[]): Command {
  const cmd = new Command(name).description(description);
  for (const sub of subs) {
    const leaf = sub.split(" ")[0] ?? sub;
    cmd
      .command(sub)
      .description(`${leaf} (pending)`)
      .allowUnknownOption()
      .action(notImplemented(`${name} ${leaf}`));
  }
  if (subs.length === 0) cmd.action(notImplemented(name));
  return group(cmd, groupName);
}

/** All not-yet-implemented top-level commands, grouped like the legacy help. */
export function stubCommands(): Command[] {
  return [
    // AUTHENTICATION & CONFIG: auth, config, call, vega are real elsewhere.

    // DECISION AGENT (agent is real elsewhere)
    stub("toolbox", "Agent toolbox lifecycle", "DECISION AGENT", [
      "create",
      "list",
      "publish",
      "unpublish",
      "delete",
      "export",
      "import",
    ]),
    stub("tool", "Tools inside a toolbox", "DECISION AGENT", [
      "upload",
      "list",
      "enable",
      "disable",
      "execute",
      "debug",
    ]),

    // AI DATA PLATFORM (bkn + resource + dataflow + vega are real elsewhere)
    stub("context", "Context loader — schema discovery, instance query", "AI DATA PLATFORM", [
      "search-schema",
      "query-object-instance",
      "query-instance-subgraph",
      "get-logic-properties",
      "get-action-info",
      "find-skills",
      "tools",
      "resources",
      "resource",
      "templates",
      "prompts",
      "prompt",
      "tool-call",
    ]),

    // TRACE AI
    stub("trace", "Diagnose conversations / build eval-sets / schema validate", "TRACE AI", [
      "diagnose",
      "eval-set",
      "schema",
    ]),

    // MODELS & SKILLS (model is real elsewhere)
    stub("skill", "Skill registry / market", "MODELS & SKILLS", [
      "list",
      "get",
      "register",
      "set-status",
      "delete",
      "market",
      "market-get",
      "download",
      "install",
      "content",
      "read-file",
      "update-metadata",
      "update-package",
      "history",
      "republish",
      "publish-history",
    ]),

    // OPERATOR: kweaver-admin lives under the `admin` subcommand (see admin.ts).

    // FOUNDATION
    stub("explore", "Launch interactive web UI (under review for scope)", "FOUNDATION", []),
  ];
}
