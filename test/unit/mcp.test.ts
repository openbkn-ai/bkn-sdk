import { afterEach, describe, expect, it, vi } from "vitest";
import { getMcpServer, listMcpServerTools, listMcpServers } from "../../src/api/mcp.js";
import type { RequestContext } from "../../src/types.js";
import { verifiedContext } from "../setup/verified-context.js";

const ctx = verifiedContext<RequestContext>({
  baseUrl: "https://demo.example.com",
  token: "t",
  insecure: false,
});

type CallArgs = [string, RequestInit];
function mockFetch(body = "{}") {
  const fetchMock = vi.fn(async () => new Response(body, { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock as unknown as typeof fetch;
}
function url(fetchMock: typeof fetch): URL {
  const call = (fetchMock as unknown as { mock: { calls: CallArgs[] } }).mock.calls[0];
  if (!call) throw new Error("fetch not called");
  return new URL(call[0]);
}
afterEach(() => vi.unstubAllGlobals());

describe("registered MCP Server endpoints", () => {
  it("maps every documented list filter and preserves a nanosecond timestamp response", async () => {
    const fetchMock = mockFetch('{"data":[{"mcp_id":"m1","create_time":1784880971306127803}]}');
    const result = await listMcpServers(ctx, {
      page: 2,
      pageSize: 50,
      sortBy: "create_time",
      sortOrder: "desc",
      name: "weather",
      source: "custom",
      category: "other",
      status: "published",
      createUser: "admin",
      isInternal: true,
      mode: "stream",
      all: true,
    });
    const requestUrl = url(fetchMock);
    expect(requestUrl.pathname).toBe("/api/agent-operator-integration/v1/mcp/list");
    expect(Object.fromEntries(requestUrl.searchParams)).toMatchObject({
      page: "2",
      page_size: "50",
      sort_by: "create_time",
      sort_order: "desc",
      name: "weather",
      source: "custom",
      category: "other",
      status: "published",
      create_user: "admin",
      is_internal: "true",
      mode: "stream",
      all: "true",
    });
    expect(result).toEqual({ data: [{ mcp_id: "m1", create_time: 1784880971306127803n }] });
  });

  it("encodes MCP ids for detail and proxy tool discovery", async () => {
    const fetchMock = mockFetch();
    await getMcpServer(ctx, "mcp / 1");
    expect(url(fetchMock).pathname).toBe("/api/agent-operator-integration/v1/mcp/mcp%20%2F%201");

    const toolsFetch = mockFetch();
    await listMcpServerTools(ctx, "mcp / 1");
    expect(url(toolsFetch).pathname).toBe(
      "/api/agent-operator-integration/v1/mcp/proxy/mcp%20%2F%201/tools",
    );
    expect(url(toolsFetch).search).toBe("");

    const draftFetch = mockFetch();
    await listMcpServerTools(ctx, "mcp-1", { draft: true });
    expect(url(draftFetch).searchParams.get("draft")).toBe("true");
  });
});
