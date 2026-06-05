import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getAgent,
  listAgentCategories,
  listAgentTemplates,
  listAgents,
} from "../../src/api/agents.js";
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
function firstCall(f: typeof fetch): CallArgs {
  const a = (f as unknown as { mock: { calls: CallArgs[] } }).mock.calls[0];
  if (!a) throw new Error("fetch not called");
  return a;
}
afterEach(() => vi.unstubAllGlobals());

describe("agent endpoints (agent-factory v3)", () => {
  it("list POSTs published/agent with paging body", async () => {
    const f = mockFetch();
    await listAgents(ctx, { name: "demo", limit: 5 });
    const call = firstCall(f);
    expect(new URL(call[0]).pathname).toBe("/api/agent-factory/v3/published/agent");
    expect(call[1].method).toBe("POST");
    expect(JSON.parse(call[1].body as string)).toMatchObject({
      name: "demo",
      limit: 5,
      offset: 0,
      is_to_square: 1,
    });
  });

  it("get encodes the id", async () => {
    const f = mockFetch();
    await getAgent(ctx, "a 1");
    expect(new URL(firstCall(f)[0]).pathname).toBe("/api/agent-factory/v3/agent/a%201");
  });

  it("templates + categories hit their GET paths", async () => {
    const f1 = mockFetch();
    await listAgentTemplates(ctx);
    expect(new URL(firstCall(f1)[0]).pathname).toBe("/api/agent-factory/v3/published/agent-tpl");
    vi.unstubAllGlobals();
    const f2 = mockFetch();
    await listAgentCategories(ctx);
    expect(new URL(firstCall(f2)[0]).pathname).toBe("/api/agent-factory/v3/category");
  });
});
