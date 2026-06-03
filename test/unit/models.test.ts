import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chatCompletions,
  getLlmModel,
  listLlmModels,
  listSmallModels,
} from "../../src/api/models.js";
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

describe("model management (mf-model-manager)", () => {
  it("llm list hits /llm/list with paging", async () => {
    const f = mockFetch();
    await listLlmModels(ctx, { name: "gpt", limit: 5 });
    const u = new URL(firstCall(f)[0]);
    expect(u.pathname).toBe("/api/mf-model-manager/v1/llm/list");
    expect(u.searchParams.get("name")).toBe("gpt");
    expect(u.searchParams.get("size")).toBe("5");
  });
  it("llm get passes model_id", async () => {
    const f = mockFetch();
    await getLlmModel(ctx, "m-1");
    expect(new URL(firstCall(f)[0]).searchParams.get("model_id")).toBe("m-1");
  });
  it("small list hits /small-model/list", async () => {
    const f = mockFetch();
    await listSmallModels(ctx);
    expect(new URL(firstCall(f)[0]).pathname).toBe("/api/mf-model-manager/v1/small-model/list");
  });
});

describe("model invocation (mf-model-api)", () => {
  it("chat POSTs OpenAI-style body to /chat/completions", async () => {
    const f = mockFetch();
    await chatCompletions(ctx, "m-1", [{ role: "user", content: "hi" }]);
    const call = firstCall(f);
    expect(new URL(call[0]).pathname).toBe("/api/mf-model-api/v1/chat/completions");
    expect(call[1].method).toBe("POST");
    expect(JSON.parse(call[1].body as string)).toEqual({
      model: "m-1",
      messages: [{ role: "user", content: "hi" }],
      stream: false,
    });
  });
});
