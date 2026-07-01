// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the OpenBKN License. See the LICENSE file in the project root.

/** `openbkn config …` — active platform + per-platform business domain. */
import { Command } from "commander";
import {
  activePlatform,
  readPlatformConfig,
  setActivePlatform,
  writePlatformConfig,
} from "../config/store.js";
import { group } from "../help/grouped-help.js";
import { InputError } from "../utils/errors.js";
import { printJson } from "../utils/output.js";
import { outputOptions } from "./_shared.js";

function requireActive(): string {
  const baseUrl = activePlatform();
  if (!baseUrl) throw new InputError("No active platform. Run `openbkn auth login <url>` first.");
  return baseUrl;
}

export function configCommand(): Command {
  const config = new Command("config").description("Per-platform CLI configuration");

  config
    .command("show")
    .description("Show the active platform and business domain")
    .action((_opts, cmd: Command) => {
      const baseUrl = activePlatform();
      printJson(
        {
          baseUrl,
          businessDomain: baseUrl ? readPlatformConfig(baseUrl).businessDomain : undefined,
        },
        outputOptions(cmd),
      );
    });

  config
    .command("set <key> <value>")
    .description("Set a config value (baseUrl | businessDomain)")
    .action((key: string, value: string, _opts, cmd: Command) => {
      if (key === "baseUrl") {
        setActivePlatform(value.replace(/\/+$/, ""));
      } else if (key === "businessDomain") {
        writePlatformConfig(requireActive(), { businessDomain: value });
      } else {
        throw new InputError(`Unknown config key: ${key} (expected baseUrl | businessDomain)`);
      }
      printJson({ ok: true, key, value }, outputOptions(cmd));
    });

  config
    .command("set-bd <value>")
    .description("Set the default business domain for the active platform")
    .action((value: string, _opts, cmd: Command) => {
      const baseUrl = requireActive();
      writePlatformConfig(baseUrl, { businessDomain: value });
      printJson({ baseUrl, businessDomain: value }, outputOptions(cmd));
    });

  config
    .command("list-bd")
    .description("List business domains (requires login)")
    .action(() => {
      throw new InputError("Not yet implemented — requires backend business-domains API.");
    });

  return group(config, "AUTHENTICATION & CONFIG");
}
