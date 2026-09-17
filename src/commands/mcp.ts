// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** `openbkn mcp …` — discover registered MCP Servers and their tools. */
import { Command } from "commander";
import { group, groupChildren, guide } from "../help/grouped-help.js";
import { DEFAULT_LIST_LIMIT } from "../types.js";
import { printJson } from "../utils/output.js";
import { clientFrom, outputOptions } from "./_shared.js";

const int = (value: string) => Number.parseInt(value, 10);
const SECRET_FIELD = /authorization|cookie|token|api[-_]?key|secret|password/i;

/** Keep the SDK payload lossless while ensuring the CLI never prints credentials. */
export function redactMcpOutput(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactMcpOutput);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SECRET_FIELD.test(key) ? "<redacted>" : redactMcpOutput(item),
    ]),
  );
}

export function mcpCommand(): Command {
  const cmd = new Command("mcp").description(
    "Registered MCP Servers: inspect their configuration and discover their tools",
  );

  cmd
    .command("list")
    .description("List MCP Servers you can access")
    .option("--name <text>", "filter by name")
    .option("--source <text>", "filter by source")
    .option("--category <text>", "filter by category")
    .option("--status <text>", "filter by status")
    .option("--create-user <text>", "filter by creator")
    .option("--internal", "show only internal servers")
    .option("--mode <mode>", "filter by connection mode")
    .option("--sort-by <field>", "sort field")
    .option("--sort-order <order>", "sort direction")
    .option("--limit <n>", "page size", int, DEFAULT_LIST_LIMIT)
    .option("--page <n>", "page (1-based)", int, 1)
    .option("--all", "return every accessible server")
    .action(async (opts, command: Command) => {
      printJson(
        redactMcpOutput(
          await clientFrom(command).mcp.list({
            page: opts.page,
            pageSize: opts.limit,
            sortBy: opts.sortBy,
            sortOrder: opts.sortOrder,
            name: opts.name,
            source: opts.source,
            category: opts.category,
            status: opts.status,
            createUser: opts.createUser,
            isInternal: opts.internal || undefined,
            mode: opts.mode,
            all: opts.all || undefined,
          }),
        ),
        outputOptions(command),
      );
    });

  cmd
    .command("get <mcp-id>")
    .description("Read one MCP Server's configuration and platform connection addresses")
    .action(async (mcpId: string, _opts, command: Command) => {
      printJson(redactMcpOutput(await clientFrom(command).mcp.get(mcpId)), outputOptions(command));
    });

  cmd
    .command("tools <mcp-id>")
    .description("List the MCP protocol tools a registered server advertises; does not invoke one")
    .action(async (mcpId: string, _opts, command: Command) => {
      printJson(
        redactMcpOutput(await clientFrom(command).mcp.tools(mcpId)),
        outputOptions(command),
      );
    });

  groupChildren(cmd, { READ: ["list", "get", "tools"] });
  guide(
    cmd,
    `WHAT THIS READS
  These are registered MCP Servers in the execution factory, not Context Loader's
  agent-facing MCP retrieval interface. \`mcp get\` includes the platform connection
  addresses; \`mcp tools\` only discovers the remote tool schemas and does not call one.

  ORDER OF WORK
  mcp list                  choose an accessible server
  mcp get <mcp-id>          inspect its configuration and connection addresses
  mcp tools <mcp-id>        inspect tool names and input schemas`,
  );
  return group(cmd, "TOOLS & SKILLS");
}
