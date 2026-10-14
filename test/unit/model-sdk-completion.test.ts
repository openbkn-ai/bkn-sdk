import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatOptions } from "../../src/api/model-chat.js";
import { createClient } from "../../src/client.js";
import { verifiedContext } from "../setup/verified-context.js";

const base = "https://model-sdk.example.com";
function client() {
  const c = createClient({ baseUrl: base, token: "mock", insecure: false });
  verifiedContext(c.ctx);
  return c;
}
function stream(data: string) {
  return new Response(data, { headers: { "content-type": "text/event-stream" } });
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("model SDK completion", () => {
  it("protects small-model management reads while retaining bigint IDs", async () => {
    const raw =
      '{"data":[{"model_id":1234567890123456789,"model_name":"emb","adapter_code":"FAKE_CODE_SECRET","model_config":{"api_key":"FAKE_KEY","headers":{"Authorization":"Bearer FAKE_BEARER"}},"max_tokens":100}]}';
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(raw)),
    );
    const c = client();
    for (const read of [
      () => c.models.small.list(),
      () => c.models.small.get("1234567890123456789"),
    ]) {
      const response = (await read()) as { data: Array<Record<string, unknown>> };
      expect(response.data[0]?.model_id).toBe(1234567890123456789n);
      expect(response.data[0]?.model_name).toBe("emb");
      expect(response.data[0]?.max_tokens).toBe(100);
      expect(
        JSON.stringify(response, (_, v) => (typeof v === "bigint" ? String(v) : v)),
      ).not.toContain("FAKE_");
    }
  });

  it.each([false, true])("resolves an LLM id inside the SDK (stream=%s)", async (streaming) => {
    const fetch = vi.fn(async (url: string | URL, _init?: RequestInit) =>
      String(url).includes("/llm/get")
        ? Response.json({ data: { model_name: "qwen" } })
        : streaming
          ? stream('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n')
          : Response.json({ choices: [] }),
    );
    vi.stubGlobal("fetch", fetch);
    const c = client();
    if (streaming)
      await c.models.llm.chatStream("123", [{ role: "user", content: "hi" }], () => {});
    else await c.models.llm.chat("123", [{ role: "user", content: "hi" }]);
    const calls = fetch.mock.calls;
    expect(calls.some(([url]) => String(url).includes("/llm/get"))).toBe(true);
    expect(JSON.parse(String(calls.at(-1)?.[1]?.body)).model).toBe("qwen");
  });

  it("maps typed chat options and tool messages to the published request", async () => {
    const fetch = vi.fn(async (_url: string | URL, _init?: RequestInit) =>
      Response.json({ choices: [] }),
    );
    vi.stubGlobal("fetch", fetch);
    const opts: ChatOptions = {
      temperature: 0,
      topP: 0.5,
      topK: 2,
      maxTokens: 20,
      maxCompletionTokens: 30,
      presencePenalty: 0,
      frequencyPenalty: -1,
      cache: false,
      stop: ["STOP"],
      system: [{ text: "system input" }],
      responseFormat: { type: "json_object" },
      tools: [
        {
          type: "function",
          function: { name: "lookup", parameters: { type: "object", properties: {} } },
        },
      ],
      toolChoice: "auto",
    };
    const messages = [
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "call-1", type: "function", function: { name: "lookup", arguments: "{}" } },
        ],
      },
      { role: "tool", content: "ok", tool_call_id: "call-1" },
    ];
    await client().models.llm.chat("qwen", messages, opts);
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      temperature: 0,
      top_p: 0.5,
      top_k: 2,
      max_tokens: 20,
      max_completion_tokens: 30,
      presence_penalty: 0,
      frequency_penalty: -1,
      cache: false,
      stop: ["STOP"],
      system: opts.system,
      response_format: opts.responseFormat,
      tools: opts.tools,
      tool_choice: "auto",
      messages,
      stream: false,
    });
  });

  it("rejects an SSE error after emitting partial text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        stream(
          'data: {"choices":[{"delta":{"content":"partial"}}]}\n\ndata: {"error":{"message":"mock failure","code":"upstream_error"}}\n\n',
        ),
      ),
    );
    const deltas: string[] = [];
    await expect(
      client().models.llm.chatStream("qwen", [{ role: "user", content: "hi" }], (text) =>
        deltas.push(text),
      ),
    ).rejects.toMatchObject({ name: "ModelStreamError", code: "upstream_error" });
    expect(deltas).toEqual(["partial"]);
  });

  it("does not swallow caller callback errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        stream('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'),
      ),
    );
    const error = new Error("callback failure");
    await expect(
      client().models.llm.chatStream("qwen", [{ role: "user", content: "hi" }], () => {
        throw error;
      }),
    ).rejects.toBe(error);
  });
});

describe("chat option boundaries and model lookup", () => {
  it.each([
    { temperature: 3 },
    { maxTokens: 9 },
    { topP: 0 },
    { timeoutMs: 0 },
    { tools: [{ type: "other" }] },
    { model: "override" },
  ])("rejects invalid options before any metadata or inference call: %j", async (opts) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      client().models.llm.chat("123", [{ role: "user", content: "hi" }], opts as ChatOptions),
    ).rejects.toMatchObject({ name: "InputError" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([401, 403, 500])("preserves lookup HTTP %s without invoking a model", async (status) => {
    const fetch = vi.fn(async () => Response.json({ error: "lookup failed" }, { status }));
    vi.stubGlobal("fetch", fetch);
    await expect(
      client().models.llm.chat("123", [{ role: "user", content: "hi" }]),
    ).rejects.toMatchObject({ status });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("accepts a bare model record and sends names without extra lookup", async () => {
    const fetch = vi.fn(async (url: string | URL) =>
      String(url).includes("/llm/get")
        ? Response.json({ model_name: "qwen" })
        : Response.json({ choices: [] }),
    );
    vi.stubGlobal("fetch", fetch);
    const c = client();
    await c.models.llm.chat("123", [{ role: "user", content: "hi" }]);
    fetch.mockClear();
    await c.models.llm.chat("qwen", [{ role: "user", content: "hi" }]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("passes caller cancellation only as transport state", async () => {
    const controller = new AbortController();
    let signal: AbortSignal | undefined;
    const fetch = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      expect(JSON.parse(String(init?.body))).not.toHaveProperty("signal");
      return Response.json({ choices: [] });
    });
    vi.stubGlobal("fetch", fetch);
    await client().models.llm.chat("qwen", [{ role: "user", content: "hi" }], {
      signal: controller.signal,
      timeoutMs: 1000,
    });
    controller.abort();
    expect(signal?.aborted).toBe(true);
  });
  it.each([false, true])(
    "does not send an already canceled request (stream=%s)",
    async (streaming) => {
      const controller = new AbortController();
      controller.abort();
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      const c = client();
      const promise = streaming
        ? c.models.llm.chatStream("123", [{ role: "user", content: "hi" }], () => {}, {
            signal: controller.signal,
          })
        : c.models.llm.chat("123", [{ role: "user", content: "hi" }], {
            signal: controller.signal,
          });
      await expect(promise).rejects.toMatchObject({ name: "AbortError" });
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});

describe("stream lifecycle", () => {
  it.each([
    ['data: {"choices":[{"delta":{"content":"partial"}}]}\n\n', "incomplete_stream"],
    ["data: invalid-json\n\n", "invalid_stream"],
    ['event: error\ndata: {"message":"failed","code":"mock_error"}\n\n', "mock_error"],
  ])("rejects failed or incomplete SSE (%s)", async (sse, code) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => stream(sse)),
    );
    await expect(
      client().models.llm.chatStream("qwen", [{ role: "user", content: "hi" }], () => {}),
    ).rejects.toMatchObject({ name: "ModelStreamError", code });
  });
  it("decodes byte-split UTF-8/CRLF, multiline events, tool-call deltas and usage", async () => {
    const tool = {
      choices: [
        {
          delta: {
            tool_calls: [{ index: 0, id: "call-1", function: { name: "lookup", arguments: "{}" } }],
          },
        },
      ],
    };
    const sse = `: keep-alive\r\ndata: {"choices":\r\ndata: [{"delta":{"content":"知识"}}]}\r\n\r\ndata: ${JSON.stringify(tool)}\r\n\r\ndata: {"usage":{"total_tokens":12}}\r\n\r\ndata: [DONE]\r\n\r\n`;
    const bytes = new TextEncoder().encode(sse);
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const b of bytes) c.enqueue(new Uint8Array([b]));
        c.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { headers: { "content-type": "text/event-stream" } })),
    );
    const onChunk = vi.fn();
    const delta = vi.fn();
    await expect(
      client().models.llm.chatStream("qwen", [{ role: "user", content: "hi" }], delta, {
        onChunk,
        maxTokens: 20,
      }),
    ).resolves.toBe("知识");
    expect(delta).toHaveBeenCalledWith("知识");
    expect(onChunk).toHaveBeenCalledWith(tool);
    expect(onChunk).toHaveBeenCalledWith({ usage: { total_tokens: 12 } });
    expect(body.locked).toBe(false);
  });
  it.each(["timeout", "cancel"])("cancels a waiting stream reader on %s", async (kind) => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { headers: { "content-type": "text/event-stream" } })),
    );
    const promise = client().models.llm.chatStream(
      "qwen",
      [{ role: "user", content: "hi" }],
      () => {},
      { signal: controller.signal, timeoutMs: 20 },
    );
    const rejected = expect(promise).rejects.toMatchObject({
      name: kind === "timeout" ? "TimeoutError" : "AbortError",
    });
    if (kind === "timeout") await vi.advanceTimersByTimeAsync(21);
    else {
      await vi.advanceTimersByTimeAsync(1);
      controller.abort();
    }
    await rejected;
    expect(cancel).toHaveBeenCalled();
    expect(body.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("retains HTTP errors and rejects a non-SSE success body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "denied" }, { status: 403 })),
    );
    await expect(
      client().models.llm.chatStream("qwen", [{ role: "user", content: "hi" }], () => {}),
    ).rejects.toMatchObject({ status: 403 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ choices: [] })),
    );
    await expect(
      client().models.llm.chatStream("qwen", [{ role: "user", content: "hi" }], () => {}),
    ).rejects.toMatchObject({ name: "ModelStreamError" });
  });
});
