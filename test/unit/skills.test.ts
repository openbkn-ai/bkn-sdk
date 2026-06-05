import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteSkill, getSkill, listSkillMarket, listSkills } from "../../src/api/skills.js";
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

describe("skill endpoints (agent-operator-integration)", () => {
  it("list maps limit→page_size", async () => {
    const f = mockFetch();
    await listSkills(ctx, { name: "demo", pageSize: 5 });
    const u = new URL(firstCall(f)[0]);
    expect(u.pathname).toBe("/api/agent-operator-integration/v1/skills");
    expect(u.searchParams.get("page_size")).toBe("5");
    expect(u.searchParams.get("name")).toBe("demo");
  });
  it("market hits /skills/market", async () => {
    const f = mockFetch();
    await listSkillMarket(ctx);
    expect(new URL(firstCall(f)[0]).pathname).toBe(
      "/api/agent-operator-integration/v1/skills/market",
    );
  });
  it("get + delete encode id and method", async () => {
    const f1 = mockFetch();
    await getSkill(ctx, "s 1");
    expect(new URL(firstCall(f1)[0]).pathname).toBe(
      "/api/agent-operator-integration/v1/skills/s%201",
    );
    vi.unstubAllGlobals();
    const f2 = mockFetch();
    await deleteSkill(ctx, "s2");
    expect(firstCall(f2)[1].method).toBe("DELETE");
  });
});
