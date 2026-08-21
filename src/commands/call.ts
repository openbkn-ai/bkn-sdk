// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** `openbkn call`/`curl` — curl-style API passthrough with auth headers. */
import { Command } from "commander";
import { rawCall } from "../api/call.js";
import { lifecycleHint } from "../api/http.js";
import { resolveContext } from "../config/resolve.js";
import { group } from "../help/grouped-help.js";
import { parseBigIntJSON } from "../utils/json-bigint.js";
import { printJson } from "../utils/output.js";
import { outputOptions, traceOptionsFrom } from "./_shared.js";

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
      const trace = traceOptionsFrom(g);
      const ctx = resolveContext({
        baseUrl: g.baseUrl,
        token: g.token,
        user: g.user,
        businessDomain: g.bizDomain,
        insecure: g.insecure,
        ...(trace ? { trace } : {}),
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
        printJson(parseBigIntJSON(res.body), out);
      } catch {
        process.stdout.write(res.body.endsWith("\n") ? res.body : `${res.body}\n`);
      }
      if (res.status >= 400) {
        // stderr, so a hint never contaminates the response the caller is
        // piping. `call` is a raw passthrough: it hands back the server's own
        // body, which names the problem but not the fix.
        const hint = lifecycleHint(res.body);
        if (hint) console.error(hint);
        process.exitCode = 1;
      }
    });

  return group(cmd, "AUTHENTICATION & CONFIG");
}
