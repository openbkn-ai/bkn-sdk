import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chatCompletions,
  chatCompletionsStream,
  getDefaultSmallModel,
  getLlmModel,
  listLlmModels,
  listSmallModels,
  setDefaultLlm,
  setDefaultSmallModel,
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

describe("default model selection", () => {
  it("set default LLM POSTs /llm/default/edit with {model_id, default}", async () => {
    const f = mockFetch();
    await setDefaultLlm(ctx, "m-1");
    const call = firstCall(f);
    expect(new URL(call[0]).pathname).toBe("/api/mf-model-manager/v1/llm/default/edit");
    expect(call[1].method).toBe("POST");
    expect(JSON.parse(call[1].body as string)).toEqual({ model_id: "m-1", default: true });
  });

  it("clear default LLM sends default:false", async () => {
    const f = mockFetch();
    await setDefaultLlm(ctx, "m-1", false);
    expect(JSON.parse(firstCall(f)[1].body as string)).toEqual({ model_id: "m-1", default: false });
  });

  it("set default small model POSTs /small-model/set-default", async () => {
    const f = mockFetch();
    await setDefaultSmallModel(ctx, "s-1");
    const call = firstCall(f);
    expect(new URL(call[0]).pathname).toBe("/api/mf-model-manager/v1/small-model/set-default");
    expect(JSON.parse(call[1].body as string)).toEqual({ model_id: "s-1", default: true });
  });

  it("get default small model GETs /small-model/get_default with model_type (default embedding)", async () => {
    const f = mockFetch();
    await getDefaultSmallModel(ctx);
    const u = new URL(firstCall(f)[0]);
    expect(u.pathname).toBe("/api/mf-model-manager/v1/small-model/get_default");
    expect(u.searchParams.get("model_type")).toBe("embedding");
  });

  it("get default small model passes an explicit type", async () => {
    const f = mockFetch();
    await getDefaultSmallModel(ctx, "reranker");
    expect(new URL(firstCall(f)[0]).searchParams.get("model_type")).toBe("reranker");
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

  it("chatStream parses SSE deltas, joins text, and asks for stream:true", async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"知识"}}]}',
      'data: {"choices":[{"delta":{"content":"图谱"}}]}',
      "data: [DONE]",
      "",
    ].join("\n\n");
    const f = vi.fn(
      async (_url: string | URL, _init?: RequestInit) =>
        new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );
    vi.stubGlobal("fetch", f);

    const deltas: string[] = [];
    const full = await chatCompletionsStream(ctx, "qwen", [{ role: "user", content: "hi" }], (t) =>
      deltas.push(t),
    );
    expect(deltas).toEqual(["知识", "图谱"]);
    expect(full).toBe("知识图谱");
    const init = f.mock.calls[0]?.[1];
    if (!init) throw new Error("fetch not called");
    const body = JSON.parse(init.body as string);
    expect(body.stream).toBe(true);
  });
});
