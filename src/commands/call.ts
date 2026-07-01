// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the OpenBKN License. See the LICENSE file in the project root.

/** `openbkn call`/`curl` — curl-style API passthrough with auth headers. */
import { Command } from "commander";
import { rawCall } from "../api/call.js";
import { resolveContext } from "../config/resolve.js";
import { group } from "../help/grouped-help.js";
import { printJson } from "../utils/output.js";
import { outputOptions } from "./_shared.js";

function collect(value: string, prev: string[]): string[] {
  prev.push(value);
  return prev;
}

export function callCommand(): Command {
  const cmd = new Command("call")
    .alias("curl")
    .description("Call an API with curl-style flags and auto-injected auth headers")
    .argument("<url>", "API path (e.g. /api/...) or absolute URL")
    .option("-X, --request <method>", "HTTP method")
    .option("-H, --header <header>", 'extra header "Name: value" (repeatable)', collect, [])
    .option("-d, --data <body>", "request body (sets JSON content-type if unset)")
    .option("--data-raw <body>", "alias for --data")
    .option(
      "-F, --form <field>",
      "multipart field key=value or key=@file (repeatable)",
      collect,
      [],
    )
    .option("-v, --verbose", "print request line to stderr")
    .action(async (url: string, opts, cmd: Command) => {
      const g = cmd.optsWithGlobals();
      const ctx = resolveContext({
        baseUrl: g.baseUrl,
        token: g.token,
        user: g.user,
        businessDomain: g.bizDomain,
        insecure: g.insecure,
      });
      const res = await rawCall(ctx, url, {
        method: opts.request,
        header: opts.header,
        data: opts.data ?? opts.dataRaw,
        form: opts.form,
        businessDomain: g.bizDomain,
        verbose: opts.verbose,
      });

      // Pretty-print JSON bodies; pass anything else through verbatim.
      const out = outputOptions(cmd);
      try {
        printJson(JSON.parse(res.body), out);
      } catch {
        process.stdout.write(res.body.endsWith("\n") ? res.body : `${res.body}\n`);
      }
      if (res.status >= 400) process.exitCode = 1;
    });

  return group(cmd, "AUTHENTICATION & CONFIG");
}
