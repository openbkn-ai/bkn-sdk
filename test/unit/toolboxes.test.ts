import { afterEach, describe, expect, it, vi } from "vitest";
import { listToolboxes, listTools } from "../../src/api/toolboxes.js";
import type { RequestContext } from "../../src/types.js";

const ctx: RequestContext = {
  baseUrl: "https://demo.example.com",
  token: "t",
  businessDomain: "bd_public",
  insecure: false,
};

type CallArgs = [string, RequestInit];
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
    expect(u.pathname).toBe("/api/agent-operator-integration/v1/tool-box");
    expect(u.searchParams.get("keyword")).toBe("analytics");
    expect(u.searchParams.get("limit")).toBe("10");
  });
  it("tools list hits /tool-box/{id}/tools/list", async () => {
    const f = mockFetch();
    await listTools(ctx, "box 1");
    expect(url(f).pathname).toBe("/api/agent-operator-integration/v1/tool-box/box%201/tools/list");
  });
});
