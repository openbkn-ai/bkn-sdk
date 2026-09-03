import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTool,
  deleteTools,
  getTool,
  listToolboxes,
  listTools,
  updateTool,
} from "../../src/api/toolboxes.js";
import type { RequestContext } from "../../src/types.js";
import { verifiedContext } from "../setup/verified-context.js";

const ctx = verifiedContext<RequestContext>({
  baseUrl: "https://demo.example.com",
  token: "t",
  insecure: false,
});

type CallArgs = [string, RequestInit];
function sent(f: typeof fetch): {
  url: URL;
  init: RequestInit;
  readonly body: Record<string, unknown>;
} {
  const a = (f as unknown as { mock: { calls: CallArgs[] } }).mock.calls[0];
  if (!a) throw new Error("fetch not called");
  // A GET carries no body; parsing it lazily keeps one helper for both.
  return {
    url: new URL(a[0]),
    init: a[1],
    get body() {
      return JSON.parse(String(a[1].body)) as Record<string, unknown>;
    },
  };
}
function mockFetch(): typeof fetch {
  const fn = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fn);
  return fn as unknown as typeof fetch;
}
function url(f: typeof fetch): URL {
  const a = (f as unknown as { mock: { calls: CallArgs[] } }).mock.calls[0];
  if (!a) throw new Error("fetch not called");
  return new URL(a[0]);
}
afterEach(() => vi.unstubAllGlobals());

describe("toolbox endpoints (tool-box)", () => {
  it("list hits /tool-box with keyword", async () => {
    const f = mockFetch();
    await listToolboxes(ctx, { keyword: "analytics", limit: 10 });
    const u = url(f);
    expect(u.pathname).toBe("/api/agent-operator-integration/v1/tool-box/list");
    expect(u.searchParams.get("keyword")).toBe("analytics");
    expect(u.searchParams.get("limit")).toBe("10");
  });
  it("tools list hits /tool-box/{id}/tools/list", async () => {
    const f = mockFetch();
    await listTools(ctx, "box 1");
    const u = url(f);
    expect(u.pathname).toBe("/api/agent-operator-integration/v1/tool-box/box%201/tools/list");
    // No explicit page/page_size → backend defaults (page=1, page_size=10) apply.
    expect(u.searchParams.has("page")).toBe(false);
    expect(u.searchParams.has("page_size")).toBe(false);
    expect(u.searchParams.has("all")).toBe(false);
  });

  it("tools list drops a NaN/zero page_size (never sends page_size=NaN)", async () => {
    const f = mockFetch();
    await listTools(ctx, "b1", { pageSize: Number.NaN });
    expect(url(f).searchParams.has("page_size")).toBe(false);
  });

  it("tools list forwards all=true to bypass the default page size", async () => {
    const f = mockFetch();
    await listTools(ctx, "b1", { all: true, pageSize: 50 });
    const u = url(f);
    expect(u.searchParams.get("all")).toBe("true");
    expect(u.searchParams.get("page_size")).toBe("50");
  });
});

describe("tools inside a box", () => {
  it("creates a function tool with the definition nested under function_input", async () => {
    const f = mockFetch();
    await createTool(ctx, "box 1", {
      metadataType: "function",
      function: { name: "add", code: "def handler(event):\n    return 1\n" },
    });
    const { url, body } = sent(f);
    expect(url.pathname).toBe("/api/agent-operator-integration/v1/tool-box/box%201/tool");
    expect(body.metadata_type).toBe("function");
    expect(body).toMatchObject({ function_input: { name: "add", script_type: "python" } });
  });

  it("sends an openapi spec as a document, not as text", async () => {
    const f = mockFetch();
    await createTool(ctx, "b1", { metadataType: "openapi", data: { openapi: "3.0.0" } });
    // The service unmarshals `data` straight into an OpenAPI type here, so a
    // string is a 400 — unlike /operator/register, which wants the text.
    expect(sent(f).body.data).toEqual({ openapi: "3.0.0" });
  });

  it("reads one tool by id", async () => {
    const f = mockFetch();
    await getTool(ctx, "b1", "t 1");
    expect(sent(f).url.pathname).toBe("/api/agent-operator-integration/v1/tool-box/b1/tool/t%201");
  });

  it("updates with POST, carrying the name and description the service demands", async () => {
    const f = mockFetch();
    await updateTool(ctx, "b1", "t1", {
      name: "add",
      description: "adds",
      metadataType: "function",
      function: { name: "add", code: "x" },
    });
    const { url, init, body } = sent(f);
    expect(url.pathname).toBe("/api/agent-operator-integration/v1/tool-box/b1/tool/t1");
    expect(init.method).toBe("POST");
    expect(body).toMatchObject({ name: "add", description: "adds", metadata_type: "function" });
  });

  it("deletes through batch-delete, ids in the body", async () => {
    const f = mockFetch();
    await deleteTools(ctx, "b1", ["t1", "t2"]);
    const { url, body } = sent(f);
    expect(url.pathname).toBe("/api/agent-operator-integration/v1/tool-box/b1/tools/batch-delete");
    expect(body).toEqual({ tool_ids: ["t1", "t2"] });
  });
});
