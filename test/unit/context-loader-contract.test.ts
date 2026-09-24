// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
// Argument defaults the context-loader contract expects on every tool call:
// `response_format: "json"` (the MCP schemas default to toon) and `kn_id` in the
// body (run_cypher / search_capabilities require it there, not only as a header).
import pkg from "../../package.json" with { type: "json" };
import { callTool, searchCapabilities, searchSchema } from "../../src/api/context-loader.js";
import { lifecycleHint } from "../../src/api/http.js";
import { resetLifecycleCaches } from "../../src/api/lifecycle.js";
import { buildProgram } from "../../src/cli-program.js";
import { context } from "../../src/resources/context-loader.js";
import type { RequestContext } from "../../src/types.js";
import { verifiedContext } from "../setup/verified-context.js";

let hostSeq = 0;
function freshCtx(): RequestContext {
  hostSeq += 1;
  return verifiedContext({
    baseUrl: `https://contract-${hostSeq}.example.com`,
    token: "t",
    insecure: false,
  });
}

/** A legacy deploy (no lifecycle tools) whose business tools answer `text`. */
function mockDeploy(text: string): Array<{ name: string; arguments: Record<string, unknown> }> {
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = { "mcp-session-id": "s1" };
      // The CLI's version preflight; SDK-level calls here are already verified.
      if (url.endsWith("/health"))
        return new Response(JSON.stringify({ ServerVersion: pkg.version }));
      if (url.endsWith("/mcp/info")) {
        return new Response(JSON.stringify({ tools: [{ name: "search_schema" }] }));
      }
      const rpc = JSON.parse(init?.body as string) as {
        method?: string;
        params?: { name: string; arguments: Record<string, unknown> };
      };
      if (rpc.method !== "tools/call" || !rpc.params) {
        return new Response(JSON.stringify({ jsonrpc: "2.0", result: {} }), { headers });
      }
      calls.push(rpc.params);
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", result: { content: [{ type: "text", text }] } }),
        { headers },
      );
    }),
  );
  return calls;
}

afterEach(() => {
  resetLifecycleCaches();
  vi.unstubAllGlobals();
});

describe("response_format defaults to json", () => {
  it.each([
    "run_sql",
    "explore_subgraph",
    "query_metric",
    "query_object_instance",
    "query_instance_subgraph",
    "get_logic_properties_values",
    "get_action_info",
    "search_capabilities",
  ])("asks %s for JSON so its result parses", async (tool) => {
    const calls = mockDeploy(JSON.stringify({ entries: [{ n: 1 }] }));
    const value = await callTool(freshCtx(), "kn-1", tool, {});
    expect(calls[0]?.arguments.response_format).toBe("json");
    // Regression: a toon body used to come back as `{ raw: "..." }`.
    expect(value).toEqual({ entries: [{ n: 1 }] });
  });

  it("keeps a response_format the caller chose", async () => {
    const calls = mockDeploy("entries[1]{n}:\n  1");
    const value = await callTool(freshCtx(), "kn-1", "run_sql", {
      sql: "SELECT 1",
      response_format: "toon",
    });
    expect(calls[0]?.arguments.response_format).toBe("toon");
    expect(value).toEqual({ raw: "entries[1]{n}:\n  1" });
  });

  it.each(["execute_tool", "execute_action", "run_code", "some_extension_tool"])(
    "adds no response_format to %s, whose schema does not declare it",
    async (tool) => {
      const calls = mockDeploy("{}");
      await callTool(freshCtx(), "kn-1", tool, {});
      expect(calls).toHaveLength(1);
      expect(calls[0]?.name).toBe(tool);
      expect(calls[0]?.arguments).not.toHaveProperty("response_format");
    },
  );
});

describe("kn_id travels in the tool arguments", () => {
  it("fills kn_id for run_cypher and search_capabilities, which require it in the body", async () => {
    const calls = mockDeploy("{}");
    const ctx = freshCtx();
    await callTool(ctx, "kn-1", "run_cypher", { query: "MATCH (o:order) RETURN count(*) AS n" });
    await searchCapabilities(ctx, "kn-1", { query: "treatment" });
    expect(calls.map((c) => c.arguments.kn_id)).toEqual(["kn-1", "kn-1"]);
  });

  it("keeps a kn_id the caller set", async () => {
    const calls = mockDeploy("{}");
    await callTool(freshCtx(), "kn-1", "get_object_types", { ids: ["a"], kn_id: "kn-other" });
    expect(calls[0]?.arguments.kn_id).toBe("kn-other");
  });

  it.each(["run_sql", "list_resources", "describe_resource", "list_knowledge_networks"])(
    "does not add kn_id to %s, where it is absent or changes the answer",
    async (tool) => {
      const calls = mockDeploy("{}");
      await callTool(freshCtx(), "kn-1", tool, {});
      expect(calls).toHaveLength(1);
      expect(calls[0]?.name).toBe(tool);
      expect(calls[0]?.arguments).not.toHaveProperty("kn_id");
    },
  );
});

describe("search_schema search_scope", () => {
  it("sends the SearchSchemaScope object in snake_case with the documented options", async () => {
    const calls = mockDeploy("{}");
    await searchSchema(freshCtx(), "kn-1", "churn", {
      searchScope: { conceptGroups: ["cg_1"], includeActionTypes: false },
      maxConcepts: 5,
      schemaBrief: false,
      enableRerank: false,
      rerankModel: "bge",
      includeColumns: true,
    });
    expect(calls[0]?.arguments).toEqual({
      kn_id: "kn-1",
      query: "churn",
      response_format: "json",
      search_scope: { concept_groups: ["cg_1"], include_action_types: false },
      max_concepts: 5,
      schema_brief: false,
      enable_rerank: false,
      rerank_model: "bge",
      include_columns: true,
    });
  });

  it("maps the legacy list form onto include flags instead of sending an array", async () => {
    const calls = mockDeploy("{}");
    await searchSchema(freshCtx(), "kn-1", "q", { searchScope: ["object", "relation"] });
    expect(calls[0]?.arguments.search_scope).toEqual({
      include_object_types: true,
      include_relation_types: true,
      include_action_types: false,
      include_metric_types: false,
    });
  });

  it("refuses a scope that excludes every concept kind before calling the deploy", async () => {
    const calls = mockDeploy("{}");
    await expect(
      searchSchema(freshCtx(), "kn-1", "q", {
        searchScope: {
          includeObjectTypes: false,
          includeRelationTypes: false,
          includeActionTypes: false,
          includeMetricTypes: false,
        },
      }),
    ).rejects.toThrow("cannot exclude every concept kind");
    expect(calls).toHaveLength(0);
  });
});

describe("context CLI flags reach the contract", () => {
  const cli = (ctx: RequestContext, ...argv: string[]) =>
    buildProgram().parseAsync(["--base-url", ctx.baseUrl, "--token", ctx.token, ...argv], {
      from: "user",
    });

  it("sends schema_brief explicitly when a flag sets it, and leaves the default otherwise", async () => {
    const configDir = mkdtempSync(join(tmpdir(), "bkn-schema-brief-"));
    const previousConfigDir = process.env.BKN_CONFIG_DIR;
    process.env.BKN_CONFIG_DIR = configDir;
    const calls = mockDeploy("{}");
    const ctx = freshCtx();
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await cli(ctx, "context", "search-schema", "kn-1", "q", "--schema-brief");
      await cli(ctx, "context", "search-schema", "kn-1", "q", "--no-schema-brief");
      await cli(ctx, "context", "search-schema", "kn-1", "q");
    } finally {
      write.mockRestore();
      if (previousConfigDir === undefined) delete process.env.BKN_CONFIG_DIR;
      else process.env.BKN_CONFIG_DIR = previousConfigDir;
      rmSync(configDir, { recursive: true, force: true });
    }
    expect(calls.map((c) => c.arguments.schema_brief)).toEqual([true, false, undefined]);
  });

  it("refuses a --detail-level that is neither summary nor full before any request", async () => {
    mockDeploy("{}");
    await expect(
      cli(freshCtx(), "context", "kn-detail", "kn-1", "--detail-level", "ful"),
    ).rejects.toThrow("--detail-level must be one of: summary | full");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("lifecycle hint reads ErrorCompact bodies", () => {
  it("finds required_action at the top level as well as under error", () => {
    expect(
      lifecycleHint(JSON.stringify({ code: "x", required_action: "bkn_start_interaction" })),
    ).toContain("bkn_context");
    expect(
      lifecycleHint(JSON.stringify({ error: { required_action: "start_interaction" } })),
    ).toContain("bkn_context");
    expect(lifecycleHint(JSON.stringify({ code: "Public.BadRequest" }))).toBeUndefined();
  });

  it("names only the contract's start tool, not the removed managed-v1 handshake", () => {
    const hint = lifecycleHint(JSON.stringify({ required_action: "bkn_start_interaction" }));
    expect(hint).toContain("bkn_start_interaction");
    expect(hint).not.toContain("bkn_create_conversation");
    for (const legacy of ["create_conversation", "ensure_operation"]) {
      expect(lifecycleHint(JSON.stringify({ required_action: legacy }))).toBeUndefined();
    }
  });
});

describe("query_object_instance validation composes with the contract defaults", () => {
  it("validates the caller's arguments, then sends kn_id and response_format=json", async () => {
    const calls = mockDeploy(JSON.stringify({ datas: [], total_count: 0 }));
    await context(freshCtx()).queryObjectInstance("kn-1", { ot_id: "ot-1", limit: 5 });
    expect(calls[0]).toEqual({
      name: "query_object_instance",
      arguments: { kn_id: "kn-1", response_format: "json", ot_id: "ot-1", limit: 5 },
    });
  });

  it("accepts kn_id and response_format as caller root keys and keeps their values", async () => {
    const calls = mockDeploy(JSON.stringify({ datas: [], total_count: 0 }));
    await context(freshCtx()).queryObjectInstance("kn-1", {
      ot_id: "ot-1",
      kn_id: "kn-1",
      response_format: "json",
    });
    expect(calls[0]?.arguments).toEqual({ kn_id: "kn-1", response_format: "json", ot_id: "ot-1" });
  });

  it("still refuses a caller kn_id naming another network before any request", async () => {
    const calls = mockDeploy("{}");
    await expect(
      context(freshCtx()).queryObjectInstance("kn-1", { ot_id: "ot-1", kn_id: "kn-2" }),
    ).rejects.toThrow("kn_id must match");
    expect(calls).toEqual([]);
  });
});
