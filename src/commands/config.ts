/** `openbkn config …` — local CLI config (base URL, business domain). */
import { Command } from "commander";
import { readConfig, writeConfig } from "../config/store.js";
import { group } from "../help/grouped-help.js";
import { printJson } from "../utils/output.js";
import { outputOptions } from "./_shared.js";

export function configCommand(): Command {
  const config = new Command("config").description("Per-platform CLI configuration");

  config
    .command("show")
    .description("Show current config (base URL, business domain)")
    .action((_opts, cmd: Command) => {
      printJson(readConfig(), outputOptions(cmd));
    });

  config
    .command("set <key> <value>")
    .description("Set a config value (baseUrl | businessDomain)")
    .action((key: string, value: string, _opts, cmd: Command) => {
      const next = readConfig();
      if (key === "baseUrl") next.baseUrl = value;
      else if (key === "businessDomain") next.businessDomain = value;
      else throw new Error(`Unknown config key: ${key} (expected baseUrl | businessDomain)`);
      writeConfig(next);
      printJson(next, outputOptions(cmd));
    });

  config
    .command("set-bd <value>")
    .description("Set the default business domain")
    .action((value: string, _opts, cmd: Command) => {
      const next = readConfig();
      next.businessDomain = value;
      writeConfig(next);
      printJson(next, outputOptions(cmd));
    });

  config
    .command("list-bd")
    .description("List business domains (requires login)")
    .action(() => {
      throw new Error("Not yet implemented — requires backend business-domains API.");
    });

  return group(config, "AUTHENTICATION & CONFIG");
}
