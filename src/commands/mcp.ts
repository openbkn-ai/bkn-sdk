// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** `openbkn mcp …` — discover registered MCP Servers and their tools. */
import { Command, Option } from "commander";
import { group, groupChildren, guide } from "../help/grouped-help.js";
import { DEFAULT_LIST_LIMIT } from "../types.js";
import { InputError } from "../utils/errors.js";
import { printJson } from "../utils/output.js";
import { clientFrom, outputOptions } from "./_shared.js";

/** Digits only, within bounds: `parseInt` would turn `1e3` into 1 and a typo into `NaN`. */
const boundedInt =
  (flag: string, max = Number.MAX_SAFE_INTEGER) =>
  (value: string) => {
    const n = /^\d+$/.test(value) ? Number.parseInt(value, 10) : Number.NaN;
    if (!Number.isSafeInteger(n) || n < 1 || n > max) {
      throw new InputError(`${flag} must be an integer from 1 to ${max} (got '${value}')`);
    }
    return n;
  };

const REDACTED = "<redacted>";
/** Names ending in a credential word. Anchored so `max_tokens` or `token_count` survive. */
const SECRET_NAME =
  /(^|[-_.])(authorization|auth|cookie|token|api[-_]?key|apikey|secret|pass|password|passwd|pwd|credentials?|private[-_]?key|access[-_]?key([-_]?id)?|secret[-_]?key|ak|sk)$/i;
/** Subtrees that describe a tool's parameters rather than a server's configuration. */
const SCHEMA_KEYS = new Set(["inputSchema", "input_schema", "outputSchema", "output_schema"]);

function redactUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return value;
  }
  let changed = false;
  if (url.password) {
    url.password = REDACTED;
    changed = true;
  }
  for (const name of [...url.searchParams.keys()]) {
    if (SECRET_NAME.test(name)) {
      url.searchParams.set(name, REDACTED);
      changed = true;
    }
  }
  return changed ? url.toString() : value;
}

/** Mask `--token xyz`, `--token=xyz` and `API_KEY=xyz` in a stdio launch command. */
function redactArgs(args: unknown[]): unknown[] {
  return args.map((arg, i) => {
    if (typeof arg !== "string") return arg;
    const assigned = /^(-{0,2})([^=\s]+)=(.*)$/.exec(arg);
    if (assigned?.[2] && SECRET_NAME.test(assigned[2])) {
      return `${assigned[1]}${assigned[2]}=${REDACTED}`;
    }
    const previous = args[i - 1];
    if (typeof previous === "string" && /^--?[^=\s]+$/.test(previous)) {
      if (SECRET_NAME.test(previous.replace(/^-+/, ""))) return REDACTED;
    }
    return arg;
  });
}

/** Every value of a header or environment map may be a credential; keep only the names. */
function maskValues(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.keys(value).map((key) => [key, REDACTED]));
}

/**
 * Keep the SDK payload lossless while ensuring the CLI never prints an upstream
 * credential: header and env values, secrets in launch args and URLs, and
 * scalar fields named like a credential. Tool schemas pass through untouched,
 * since a parameter called `api_key` or `max_tokens` is not itself a secret.
 */
export function redactMcpOutput(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactMcpOutput);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => {
      if (SCHEMA_KEYS.has(key)) return [key, item];
      if (key === "headers" || key === "env") return [key, maskValues(item)];
      if (key === "args" && Array.isArray(item)) return [key, redactArgs(item)];
      if (typeof item === "string" && /url$/i.test(key)) return [key, redactUrl(item)];
      if (item !== null && typeof item !== "object" && SECRET_NAME.test(key)) {
        return [key, REDACTED];
      }
      return [key, redactMcpOutput(item)];
    }),
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
    .option("--status <status>", "filter by status (unpublish|published|offline|editing)")
    .option("--create-user <text>", "filter by creator")
    .option("--internal", "show only internal servers")
    .addOption(
      new Option("--mode <mode>", "filter by connection mode").choices([
        "sse",
        "stream",
        "stdio_uv",
        "stdio_npx",
      ]),
    )
    .addOption(
      new Option("--sort-by <field>", "sort field").choices(["update_time", "create_time", "name"]),
    )
    .addOption(new Option("--sort-order <order>", "sort direction").choices(["asc", "desc"]))
    .option("--limit <n>", "page size (1-100)", boundedInt("--limit", 100), DEFAULT_LIST_LIMIT)
    .option("--page <n>", "page (1-based)", boundedInt("--page"), 1)
    .option("--all", "return every accessible server (ignores --limit/--page defaults)")
    .action(async (opts, command: Command) => {
      // `all` makes the server ignore paging, so with --all the defaults are not
      // sent; a --limit/--page the caller typed still goes out as given.
      const paging = (flag: "page" | "limit") =>
        opts.all && command.getOptionValueSource(flag) === "default" ? undefined : opts[flag];
      printJson(
        redactMcpOutput(
          await clientFrom(command).mcp.list({
            page: paging("page"),
            pageSize: paging("limit"),
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
    .option("--draft", "list the tools of the draft configuration (needs view permission)")
    .action(async (mcpId: string, opts: { draft?: boolean }, command: Command) => {
      printJson(
        redactMcpOutput(
          await clientFrom(command).mcp.tools(mcpId, { draft: opts.draft || undefined }),
        ),
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
  mcp tools <mcp-id>        inspect tool names and input schemas

  CREDENTIALS
  Output masks header and env values, secrets in launch args and URLs, and
  credential-named fields. Tool input schemas are printed as advertised.`,
  );
  return group(cmd, "TOOLS & SKILLS");
}
