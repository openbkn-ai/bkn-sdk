import { afterEach, describe, expect, it, vi } from "vitest";
import { relationTypePaths } from "../../src/api/bkn-backend.js";
import {
  getKnowledgeNetwork,
  listKnowledgeNetworks,
  listObjectTypes,
  listRelationTypes,
  queryObjectTypeInstances,
  querySubgraph,
  semanticSearch,
} from "../../src/api/knowledge-networks.js";
import type { RequestContext } from "../../src/types.js";

const ctx: RequestContext = {
  baseUrl: "https://demo.example.com",
  token: "t",
  businessDomain: "bd_public",
  insecure: false,
};

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

afterEach(() => vi.unstubAllGlobals());

describe("listKnowledgeNetworks", () => {
  it("hits ontology-manager with default paging + sort", async () => {
    const fetchMock = mockFetch();
    await listKnowledgeNetworks(ctx);
    const url = new URL(firstCall(fetchMock)[0]);
    expect(url.pathname).toBe("/api/ontology-manager/v1/knowledge-networks");
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
    expect(url.pathname).toBe("/api/ontology-manager/v1/knowledge-networks/kn%201");
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

describe("schema lists (ontology-manager)", () => {
  it("object-types: branch + limit defaults", async () => {
    const f = mockFetch();
    await listObjectTypes(ctx, "kn-1");
    const u = new URL(firstCall(f)[0]);
    expect(u.pathname).toBe("/api/ontology-manager/v1/knowledge-networks/kn-1/object-types");
    expect(u.searchParams.get("branch")).toBe("main");
    expect(u.searchParams.get("limit")).toBe("-1");
  });
  it("relation-types path", async () => {
    const f = mockFetch();
    await listRelationTypes(ctx, "kn-1");
    expect(new URL(firstCall(f)[0]).pathname).toBe(
      "/api/ontology-manager/v1/knowledge-networks/kn-1/relation-types",
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

describe("semanticSearch", () => {
  it("POSTs the retrieval body with defaults", async () => {
    const fetchMock = mockFetch();
    await semanticSearch(ctx, "kn-1", "churn");
    const call = firstCall(fetchMock);
    expect(new URL(call[0]).pathname).toBe("/api/agent-retrieval/v1/kn/semantic-search");
    expect(call[1].method).toBe("POST");
    expect(JSON.parse(call[1].body as string)).toMatchObject({
      kn_id: "kn-1",
      query: "churn",
      mode: "keyword_vector_retrieval",
      max_concepts: 10,
    });
  });
});
