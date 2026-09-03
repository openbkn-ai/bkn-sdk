// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** `openbkn call`/`curl` — curl-style API passthrough with auth headers. */
import { Command } from "commander";
import { rawCall } from "../api/call.js";
import { lifecycleHint } from "../api/http.js";
import { resolveContext } from "../config/resolve.js";
import { group, guide } from "../help/grouped-help.js";
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
    .description("Call any platform API endpoint directly (auth added)")
    .argument("<url>", "API path (e.g. /api/...) or absolute URL on the current platform")
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
        insecure: g.insecure,
        versionCheckMode: "cli",
        ...(trace ? { trace } : {}),
      });
      const res = await rawCall(ctx, url, {
        method: opts.request,
        header: opts.header,
        data: opts.data ?? opts.dataRaw,
        form: opts.form,
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

  guide(
    cmd,
    `WHEN TO USE THIS
  Anything the named commands do not cover: services with no command group yet
  (bkn-agent, execution-factory operators and sandbox functions, MCP registration,
  skill index builds), and endpoints newer than this CLI.

FINDING THE PATH
  Every service's API is documented at https://openbkn-ai.github.io/bkn-foundry/ —
  read the path and request body there rather than guessing. Authentication and
  TLS flags are injected the same way as for any other command.`,
  );
  return group(cmd, "RAW API");
}
