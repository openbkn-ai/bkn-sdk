// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import { listLlmModels, listSmallModels } from "../../src/api/models.js";
import { buildProgram } from "../../src/cli-program.js";
import { writeVersionCheckCache } from "../../src/config/store.js";
import type { RequestContext } from "../../src/types.js";
import { verifiedContext } from "../setup/verified-context.js";

const base = "https://model-cli.example.com";

beforeEach(() => {
  writeVersionCheckCache(base, { serverVersion: pkg.version, checkedAt: new Date().toISOString() });
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("model list queries", () => {
  const ctx = verifiedContext<RequestContext>({ baseUrl: base, token: "t", insecure: false });

  it("omits unset name and model_type instead of sending empty filters", async () => {
    const fetch = vi.fn(async (_url: string | URL) => Response.json({ data: [], count: 0 }));
    vi.stubGlobal("fetch", fetch);
    await listLlmModels(ctx);
    await listSmallModels(ctx);
    for (const call of fetch.mock.calls) {
      expect(Object.fromEntries(new URL(String(call[0])).searchParams)).toEqual({
        page: "1",
        size: "30",
      });
    }
  });

  it("filters the small-model list by model_name, the parameter that route reads", async () => {
    const fetch = vi.fn(async (_url: string | URL) => Response.json({ data: [], count: 0 }));
    vi.stubGlobal("fetch", fetch);
    await listSmallModels(ctx, { name: "bge", modelType: "embedding" });
    const query = new URL(String(fetch.mock.calls[0]?.[0])).searchParams;
    expect(query.get("model_name")).toBe("bge");
    expect(query.has("name")).toBe(false);
    expect(query.get("model_type")).toBe("embedding");
  });
});

describe("model llm chat <numeric id>", () => {
  it("resolves the name from a {data: {model_name}} envelope", async () => {
    const fetch = vi.fn(async (url: string | URL, _init?: RequestInit) =>
      String(url).includes("/llm/get")
        ? Response.json({ data: { model_name: "qwen-max" } })
        : Response.json({ choices: [] }),
    );
    vi.stubGlobal("fetch", fetch);
    await buildProgram().parseAsync(
      ["--base-url", base, "--token", "t", "model", "llm", "chat", "123", "-m", "hi"],
      { from: "user" },
    );
    const chat = fetch.mock.calls.find(([url]) => String(url).includes("/chat/completions"));
    expect(JSON.parse(String((chat?.[1] as RequestInit | undefined)?.body)).model).toBe("qwen-max");
  });
});

describe("model output protection and chat options", () => {
  it.each([
    ["model", "small", "list"],
    ["model", "small", "get", "123"],
    ["admin", "small-model", "list"],
    ["admin", "small-model", "get", "123"],
  ])("redacts model metadata before CLI output: %j", async (...command) => {
    const stdout: string[] = [];
    vi.mocked(process.stdout.write).mockImplementation((part) => {
      stdout.push(String(part));
      return true;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: [
            {
              model_id: "123",
              adapter_code: "FAKE_CLI_SECRET",
              model_config: { api_key: "FAKE_KEY" },
            },
          ],
        }),
      ),
    );
    await buildProgram().parseAsync(["--base-url", base, "--token", "t", "--json", ...command], {
      from: "user",
    });
    const result = JSON.parse(stdout.join(""));
    expect(result.data[0].model_id).toBe("123");
    expect(result.data[0].adapter_code).toBe("<redacted>");
    expect(stdout.join("")).not.toContain("FAKE_");
  });

  it("passes camelCase chat options through the shared SDK", async () => {
    const fetch = vi.fn(async (_url: string | URL, _init?: RequestInit) =>
      Response.json({ choices: [] }),
    );
    vi.stubGlobal("fetch", fetch);
    await buildProgram().parseAsync(
      [
        "--base-url",
        base,
        "--token",
        "t",
        "model",
        "llm",
        "chat",
        "qwen",
        "-m",
        "hi",
        "--options",
        '{"temperature":0,"maxTokens":20}',
      ],
      { from: "user" },
    );
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      temperature: 0,
      max_tokens: 20,
    });
  });
});

describe("CLI streaming failures", () => {
  it("rejects upstream SSE errors after printing only the partial text", async () => {
    const stdout: string[] = [];
    vi.mocked(process.stdout.write).mockImplementation((part) => {
      stdout.push(String(part));
      return true;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            'data: {"choices":[{"delta":{"content":"partial"}}]}\n\ndata: {"error":{"message":"mock failure","code":"mock_code"}}\n\n',
            { headers: { "content-type": "text/event-stream" } },
          ),
      ),
    );
    await expect(
      buildProgram().parseAsync(
        [
          "--base-url",
          base,
          "--token",
          "t",
          "model",
          "llm",
          "chat",
          "qwen",
          "-m",
          "hi",
          "--stream",
        ],
        { from: "user" },
      ),
    ).rejects.toMatchObject({ name: "ModelStreamError", code: "mock_code" });
    expect(stdout.join("")).toBe("partial");
  });
});
