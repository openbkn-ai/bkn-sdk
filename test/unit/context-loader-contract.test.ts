// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

// Argument defaults the context-loader contract expects on every tool call:
// `response_format: "json"` (the MCP schemas default to toon) and `kn_id` in the
// body (run_cypher / search_capabilities require it there, not only as a header).
import { afterEach, describe, expect, it, vi } from "vitest";
import { callTool, searchCapabilities, searchSchema } from "../../src/api/context-loader.js";
import { lifecycleHint } from "../../src/api/http.js";
import { resetLifecycleCaches } from "../../src/api/lifecycle.js";
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
});
