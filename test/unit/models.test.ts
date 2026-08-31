import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chatCompletions,
  chatCompletionsStream,
  embeddings,
  getDefaultSmallModel,
  getLlmModel,
  listLlmModels,
  listSmallModels,
  rerank,
  resolveSmallModel,
  setDefaultLlm,
  setDefaultSmallModel,
} from "../../src/api/models.js";
import type { RequestContext } from "../../src/types.js";

const ctx: RequestContext = {
  baseUrl: "https://demo.example.com",
  token: "t",
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

describe("small-model calls take a name or an id", () => {
  // `small list` and `small get-default` lead with the numeric `model_id`, so
  // the first value a user copies is the one the backend rejects — with
  // `ModelFactory.ExternalSmallModel.*` and an HTTP 400, which names neither
  // the field nor the fact that a name was wanted. `llm chat` has resolved ids
  // client-side since cffe7e3; these two never did.
  function mockLookup(body: unknown = { model_name: "text-embedding-v4" }) {
    const fn = vi.fn(async (input: string) =>
      new URL(input).pathname.startsWith("/api/mf-model-manager")
        ? new Response(JSON.stringify(body), { status: 200 })
        : new Response("{}", { status: 200 }),
    );
    vi.stubGlobal("fetch", fn);
    return fn as unknown as typeof fetch;
  }
  const calls = (f: typeof fetch) => (f as unknown as { mock: { calls: CallArgs[] } }).mock.calls;

  it("resolves a numeric id to the name embeddings must send", async () => {
    const f = mockLookup();
    await embeddings(ctx, "2064382281006583808", ["apple"]);
    const lookup = calls(f).find(([u]) => String(u).includes("/mf-model-manager"));
    expect(new URL(lookup?.[0] ?? "").searchParams.get("model_id")).toBe("2064382281006583808");
    expect(JSON.parse(calls(f).at(-1)?.[1].body as string).model).toBe("text-embedding-v4");
  });

  it("resolves a numeric id to the name rerank must send", async () => {
    const f = mockLookup({ model_name: "reranker" });
    await rerank(ctx, "2071900034219999001", "apple", ["banana"]);
    expect(JSON.parse(calls(f).at(-1)?.[1].body as string).model).toBe("reranker");
  });

  it("sends a name through untouched, without a lookup", async () => {
    const f = mockLookup();
    await embeddings(ctx, "text-embedding-v4", ["apple"]);
    expect(calls(f).some(([u]) => String(u).includes("/mf-model-manager"))).toBe(false);
    expect(JSON.parse(calls(f).at(-1)?.[1].body as string).model).toBe("text-embedding-v4");
  });
});

describe("resolving a small-model name to its id", () => {
  it("pages with page + size, never limit", async () => {
    // `limit: -1` is not a value mf-model-manager takes: it answers
    // `ModelFactory.Router.ParamError.FormatError`, and the whole index write
    // fails on a model lookup rather than on anything about the resource.
    const fn = vi.fn(
      async () =>
        new Response(JSON.stringify({ count: 1, data: [{ model_id: "42", model_name: "emb" }] }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fn);
    await expect(resolveSmallModel(ctx, "emb")).resolves.toEqual({ id: "42", name: "emb" });
    const url = new URL(
      (fn as unknown as { mock: { calls: CallArgs[] } }).mock.calls[0]?.[0] ?? "",
    );
    expect(url.searchParams.get("size")).toBe("100");
    expect(url.searchParams.get("page")).toBe("1");
    expect(url.searchParams.get("limit")).toBeNull();
  });

  it("names a model the platform does not have", async () => {
    // The `name` query parameter is ignored by the deploy — it answers with
    // every model whatever is asked for — so a wrong name is only caught by
    // matching here, never by an empty response.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ count: 1, data: [{ model_id: "42", model_name: "other" }] }),
            { status: 200 },
          ),
      ),
    );
    await expect(resolveSmallModel(ctx, "emb")).rejects.toThrow(/No small model named emb/);
  });
});
