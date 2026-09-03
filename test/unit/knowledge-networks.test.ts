import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { relationTypePaths } from "../../src/api/bkn-backend.js";
import {
  dryRunMetric,
  executeActionType,
  getActionExecution,
  getActionLog,
  getKnowledgeNetwork,
  listActionLogs,
  listKnowledgeNetworks,
  listObjectTypes,
  listRelationTypes,
  queryActionType,
  queryMetricData,
  queryObjectTypeInstances,
  querySubgraph,
  searchInstance,
} from "../../src/api/knowledge-networks.js";
import { resetLifecycleCaches } from "../../src/api/lifecycle.js";
import { readBody } from "../../src/commands/_shared.js";
import type { RequestContext } from "../../src/types.js";
import { verifiedContext } from "../setup/verified-context.js";

const ctx = verifiedContext<RequestContext>({
  baseUrl: "https://demo.example.com",
  token: "t",
  insecure: false,
});

type CallArgs = [string, RequestInit];

function mockFetch(): typeof fetch {
  const fn = vi.fn(
    async (_url: string | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fn);
  return fn as unknown as typeof fetch;
}

/** First fetch call's [url, init], asserted non-empty. */
function firstCall(fetchMock: typeof fetch): CallArgs {
  const args = (fetchMock as unknown as { mock: { calls: CallArgs[] } }).mock.calls[0];
  if (!args) throw new Error("fetch was not called");
  return args;
}

/** The fetch call to a given path, for endpoints reached after a capability probe. */
function callTo(fetchMock: typeof fetch, pathname: string): CallArgs {
  const calls = (fetchMock as unknown as { mock: { calls: CallArgs[] } }).mock.calls;
  const args = calls.find(([url]) => new URL(url).pathname === pathname);
  if (!args) throw new Error(`no fetch to ${pathname}`);
  return args;
}

afterEach(() => vi.unstubAllGlobals());

describe("listKnowledgeNetworks", () => {
  it("hits bkn-backend with default paging + sort", async () => {
    const fetchMock = mockFetch();
    await listKnowledgeNetworks(ctx);
    const url = new URL(firstCall(fetchMock)[0]);
    expect(url.pathname).toBe("/api/bkn-backend/v1/knowledge-networks");
    expect(url.searchParams.get("limit")).toBe("30");
    expect(url.searchParams.get("sort")).toBe("update_time");
    expect(url.searchParams.get("direction")).toBe("desc");
  });

  it("passes name_pattern only when set", async () => {
    const fetchMock = mockFetch();
    await listKnowledgeNetworks(ctx, { namePattern: "orders", limit: 5 });
    const url = new URL(firstCall(fetchMock)[0]);
    expect(url.searchParams.get("name_pattern")).toBe("orders");
    expect(url.searchParams.get("limit")).toBe("5");
  });
});

describe("getKnowledgeNetwork", () => {
  it("encodes the id and adds export/stats flags", async () => {
    const fetchMock = mockFetch();
    await getKnowledgeNetwork(ctx, "kn 1", { exportMode: true, stats: true });
    const url = new URL(firstCall(fetchMock)[0]);
    expect(url.pathname).toBe("/api/bkn-backend/v1/knowledge-networks/kn%201");
    expect(url.searchParams.get("mode")).toBe("export");
    expect(url.searchParams.get("include_statistics")).toBe("true");
  });
});

describe("create + delete", () => {
  it("create POSTs name + branch + base_branch", async () => {
    const { createKnowledgeNetwork } = await import("../../src/api/knowledge-networks.js");
    const f = mockFetch();
    await createKnowledgeNetwork(ctx, { name: "demo" });
    const call = firstCall(f);
    expect(call[1].method).toBe("POST");
    expect(JSON.parse(call[1].body as string)).toEqual({
      name: "demo",
      branch: "main",
      base_branch: "",
    });
  });
  it("delete DELETEs by id", async () => {
    const { deleteKnowledgeNetwork } = await import("../../src/api/knowledge-networks.js");
    const f = mockFetch();
    await deleteKnowledgeNetwork(ctx, "kn-9");
    expect(firstCall(f)[1].method).toBe("DELETE");
  });
});

describe("schema lists (bkn-backend)", () => {
  it("object-types: branch + limit defaults", async () => {
    const f = mockFetch();
    await listObjectTypes(ctx, "kn-1");
    const u = new URL(firstCall(f)[0]);
    expect(u.pathname).toBe("/api/bkn-backend/v1/knowledge-networks/kn-1/object-types");
    expect(u.searchParams.get("branch")).toBe("main");
    expect(u.searchParams.get("limit")).toBe("-1");
  });
  it("relation-types path", async () => {
    const f = mockFetch();
    await listRelationTypes(ctx, "kn-1");
    expect(new URL(firstCall(f)[0]).pathname).toBe(
      "/api/bkn-backend/v1/knowledge-networks/kn-1/relation-types",
    );
  });
});

describe("reads tunnelled over POST", () => {
  /** Header lookup that tolerates both a plain object and a Headers instance. */
  function header(init: RequestInit, name: string): string | undefined {
    const h = init.headers;
    if (h instanceof Headers) return h.get(name) ?? undefined;
    return (h as Record<string, string> | undefined)?.[name];
  }

  it("subgraph sends the GET override", async () => {
    const f = mockFetch();
    await querySubgraph(ctx, "kn-1", { source_object_type_id: "ot-1" });
    const [url, init] = firstCall(f);
    expect(new URL(url).pathname).toBe("/api/ontology-query/v1/knowledge-networks/kn-1/subgraph");
    expect(init.method).toBe("POST");
    expect(header(init, "X-HTTP-Method-Override")).toBe("GET");
  });

  it("object-type instance query sends the GET override", async () => {
    const f = mockFetch();
    await queryObjectTypeInstances(ctx, "kn-1", "ot-1", { limit: 1 });
    const [url, init] = firstCall(f);
    expect(new URL(url).pathname).toBe(
      "/api/ontology-query/v1/knowledge-networks/kn-1/object-types/ot-1",
    );
    expect(header(init, "X-HTTP-Method-Override")).toBe("GET");
  });

  it("preserves object-query integer boundaries in responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            '{"values":[9007199254740991,9007199254740992,9223372036854775807,-9223372036854775808,18446744073709551615]}',
            { status: 200 },
          ),
      ),
    );

    await expect(queryObjectTypeInstances(ctx, "kn-1", "ot-1", { limit: 1 })).resolves.toEqual({
      values: [
        9007199254740991,
        9007199254740992n,
        9223372036854775807n,
        -9223372036854775808n,
        18446744073709551615n,
      ],
    });
  });

  it("sends an unsafe object-query condition without rounding", async () => {
    const fetchMock = mockFetch();
    const body = readBody({
      body: '{"condition":{"field":"id_card","operation":"==","value":110101199001152345}}',
    });

    await queryObjectTypeInstances(ctx, "kn-1", "ot-1", body);

    expect(firstCall(fetchMock)[1].body).toBe(
      '{"condition":{"field":"id_card","operation":"==","value":110101199001152345}}',
    );
  });

  it("preserves unsafe integers in other dynamic ontology-query responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"value":9223372036854775807}', { status: 200 })),
    );

    await expect(querySubgraph(ctx, "kn-1", {})).resolves.toEqual({ value: 9223372036854775807n });
    await expect(queryActionType(ctx, "kn-1", "at-1", {})).resolves.toEqual({
      value: 9223372036854775807n,
    });
    await expect(executeActionType(ctx, "kn-1", "at-1", {})).resolves.toEqual({
      value: 9223372036854775807n,
    });
    await expect(getActionExecution(ctx, "kn-1", "ae-1")).resolves.toEqual({
      value: 9223372036854775807n,
    });
    await expect(listActionLogs(ctx, "kn-1")).resolves.toEqual({ value: 9223372036854775807n });
    await expect(getActionLog(ctx, "kn-1", "log-1")).resolves.toEqual({
      value: 9223372036854775807n,
    });
    await expect(queryMetricData(ctx, "kn-1", "m-1", {})).resolves.toEqual({
      value: 9223372036854775807n,
    });
    await expect(dryRunMetric(ctx, "kn-1", {})).resolves.toEqual({ value: 9223372036854775807n });
  });

  it("relation-type-paths sends the GET override", async () => {
    const f = mockFetch();
    await relationTypePaths(ctx, "kn-1", { source_object_type_id: "ot-1" });
    const [url, init] = firstCall(f);
    expect(new URL(url).pathname).toBe(
      "/api/bkn-backend/v1/knowledge-networks/kn-1/relation-type-paths",
    );
    expect(header(init, "X-HTTP-Method-Override")).toBe("GET");
  });
});

describe("searchInstance", () => {
  // Search probes the MCP tool catalog first to decide whether this deploy
  // needs a `bkn_context`, so the retrieval POST is no longer the first call.
  beforeEach(() => resetLifecycleCaches());

  it("POSTs only the sentence when nothing is narrowed", async () => {
    const fetchMock = mockFetch();
    await searchInstance(ctx, "kn-1", "churn");
    const call = callTo(fetchMock, "/api/agent-retrieval/v1/kn/search_instance");
    expect(call[1].method).toBe("POST");
    const body = JSON.parse(call[1].body as string);
    expect(body).toMatchObject({ kn_id: "kn-1", query: "churn" });
    // The server owns the defaults for everything else, so an untouched flag
    // must not travel as an explicit value.
    expect(body).not.toHaveProperty("max_object_types");
    expect(body).not.toHaveProperty("rerank");
    expect(body).not.toHaveProperty("include_object_types");
  });

  it("passes the narrowing options through under their wire names", async () => {
    const fetchMock = mockFetch();
    await searchInstance(ctx, "kn-1", "churn", {
      objectTypes: ["customer"],
      excludeObjectTypes: ["log"],
      conceptGroups: ["sales"],
      maxObjectTypes: 3,
      maxInstancesPerType: 2,
      rerank: true,
      includeObjectTypes: false,
    });
    const call = callTo(fetchMock, "/api/agent-retrieval/v1/kn/search_instance");
    expect(JSON.parse(call[1].body as string)).toMatchObject({
      object_types: ["customer"],
      exclude_object_types: ["log"],
      concept_groups: ["sales"],
      max_object_types: 3,
      max_instances_per_type: 2,
      rerank: true,
      include_object_types: false,
    });
  });

  it("leaves the body untouched when the deploy has no lifecycle tools", async () => {
    const fetchMock = mockFetch();
    await searchInstance(ctx, "kn-1", "churn");
    const call = callTo(fetchMock, "/api/agent-retrieval/v1/kn/search_instance");
    expect(JSON.parse(call[1].body as string)).not.toHaveProperty("bkn_context");
  });
});

describe("validateMetric", () => {
  it("POSTs to metrics/validation (OpenAPI path)", async () => {
    const { validateMetric } = await import("../../src/api/knowledge-networks.js");
    const fetchMock = mockFetch();
    await validateMetric(ctx, "kn-1", { entries: [] });
    const call = firstCall(fetchMock);
    expect(new URL(call[0]).pathname).toBe(
      "/api/bkn-backend/v1/knowledge-networks/kn-1/metrics/validation",
    );
    expect(call[1].method).toBe("POST");
  });
});
