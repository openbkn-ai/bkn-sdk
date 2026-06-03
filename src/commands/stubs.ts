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

    // DECISION AGENT: agent + toolbox + tool are real elsewhere.

    // AI DATA PLATFORM: bkn + resource + dataflow + context + vega are real elsewhere.

    // TRACE AI
    stub("trace", "Diagnose conversations / build eval-sets / schema validate", "TRACE AI", [
      "diagnose",
      "eval-set",
      "schema",
    ]),

    // MODELS & SKILLS: model + skill are real elsewhere.

    // OPERATOR: kweaver-admin lives under the `admin` subcommand (see admin.ts).

    // FOUNDATION
    stub("explore", "Launch interactive web UI (under review for scope)", "FOUNDATION", []),
  ];
}
