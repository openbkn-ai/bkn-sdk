// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * `openbkn explore` — a minimal local web server exposing read-only JSON
 * endpoints for **bkn** and **vega** (no SPA bundle, no chat). Reuses the
 * configured client; meant for quick local data poking, not a full UI.
 */
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { Command } from "commander";
import type { BknClient } from "../client.js";
import { group } from "../help/grouped-help.js";
import { clientFrom } from "./_shared.js";

const int = (v: string) => Number.parseInt(v, 10);

type Handler = (
  client: BknClient,
  query: URLSearchParams,
  body: Record<string, unknown>,
) => Promise<unknown>;

/** Route table: `${METHOD} ${pathname}` → handler. bkn + vega read paths only. */
const ROUTES: Record<string, Handler> = {
  "GET /api/bkn/meta": (c, q) => c.kn.get(req(q, "knId")),
  "POST /api/bkn/search": (c, _q, b) =>
    c.kn.search(str(b.knId), str(b.query), {
      maxConcepts: typeof b.maxConcepts === "number" ? b.maxConcepts : undefined,
    }),
  "POST /api/bkn/instances": (c, _q, b) =>
    c.kn.objectTypeQuery(str(b.knId), str(b.objectTypeId), b.body ?? {}),
  "POST /api/bkn/subgraph": (c, _q, b) => c.kn.subgraph(str(b.knId), b.body ?? b),
  "POST /api/bkn/properties": (c, _q, b) =>
    c.kn.objectTypeProperties(str(b.knId), str(b.objectTypeId)),
  "GET /api/vega/catalogs": (c) => c.vega.catalogs(),
  "GET /api/vega/catalog": (c, q) => c.vega.getCatalog(req(q, "catalogId")),
  "GET /api/vega/catalog-resources": (c, q) =>
    c.vega.catalogResources(req(q, "catalogId"), q.get("category") ?? undefined),
  "GET /api/vega/connector-types": (c) => c.vega.connectorTypes(),
  "POST /api/vega/query": (c, _q, b) => c.resource.query(str(b.resourceId), b.options ?? {}),
};

function str(v: unknown): string {
  return typeof v === "string" ? v : String(v ?? "");
}
function req(q: URLSearchParams, key: string): string {
  const v = q.get(key);
  if (!v) throw new Error(`missing query param: ${key}`);
  return v;
}

function readBody(reqMsg: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = "";
    reqMsg.on("data", (chunk) => {
      data += chunk;
    });
    reqMsg.on("end", () => {
      if (!data.trim()) return resolve({});
      try {
        resolve(JSON.parse(data) as Record<string, unknown>);
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    reqMsg.on("error", reject);
  });
}

const INDEX = `<!doctype html><meta charset="utf-8"><title>openbkn explore</title>
<h1>openbkn explore</h1>
<p>Read-only JSON endpoints for bkn + vega:</p>
<ul>${Object.keys(ROUTES)
  .map((r) => `<li><code>${r}</code></li>`)
  .join("")}</ul>`;

export function exploreCommand(): Command {
  const cmd = new Command("explore").description(
    "Start a local web server with read-only bkn + vega JSON endpoints",
  );
  cmd
    .option("--port <n>", "port to listen on", int, 7777)
    .option("--host <h>", "host to bind", "127.0.0.1")
    .action(async (opts, command: Command) => {
      const client = clientFrom(command);
      const server = createServer((reqMsg, res) => {
        void handle(client, reqMsg, res);
      });
      server.listen(opts.port, opts.host, () => {
        console.error(`openbkn explore running at http://${opts.host}:${opts.port}/`);
        console.error("bkn + vega read endpoints only. Press Ctrl+C to stop.");
      });
    });
  return group(cmd, "FOUNDATION");
}

async function handle(
  client: BknClient,
  reqMsg: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(reqMsg.url ?? "/", "http://localhost");
  const method = reqMsg.method ?? "GET";
  if (method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(INDEX);
    return;
  }
  const handler = ROUTES[`${method} ${url.pathname}`];
  if (!handler) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }
  try {
    const body = method === "GET" ? {} : await readBody(reqMsg);
    const data = await handler(client, url.searchParams, body);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(data ?? null));
  } catch (err) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
}
