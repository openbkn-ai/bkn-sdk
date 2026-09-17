import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTool,
  debugTool,
  deleteTools,
  executeTool,
  getTool,
  importConfig,
  listToolboxes,
  listTools,
  updateTool,
} from "../../src/api/toolboxes.js";
import { toolboxes } from "../../src/resources/toolboxes.js";
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
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A nanosecond timestamp as the service writes it — past 2^53. */
const NANOS = "1784431697368964901";

function mockFetchText(text: string): typeof fetch {
  const fn = vi.fn(async () => new Response(text, { status: 200 }));
  vi.stubGlobal("fetch", fn);
  return fn as unknown as typeof fetch;
}

describe("toolbox endpoints (tool-box)", () => {
  it("list sends the service's own query names, never keyword/limit/offset", async () => {
    const f = mockFetch();
    await listToolboxes(ctx, {
      name: "analytics",
      page: 2,
      pageSize: 10,
      sortBy: "name",
      sortOrder: "asc",
      status: "published",
      category: "data_query",
      createUser: "alice",
      releaseUser: "bob",
      metadataType: "function",
      all: true,
    });
    const u = url(f);
    expect(u.pathname).toBe("/api/agent-operator-integration/v1/tool-box/list");
    expect(Object.fromEntries(u.searchParams)).toEqual({
      name: "analytics",
      page: "2",
      page_size: "10",
      sort_by: "name",
      sort_order: "asc",
      status: "published",
      category: "data_query",
      create_user: "alice",
      release_user: "bob",
      metadata_type: "function",
      all: "true",
    });
  });

  it("list maps the deprecated keyword/limit onto name/page_size", async () => {
    const f = mockFetch();
    await listToolboxes(ctx, { keyword: "analytics", limit: 10 });
    const u = url(f);
    // The service ignored `keyword` and `limit`, so a filter silently returned
    // the first unfiltered page.
    expect(u.searchParams.get("name")).toBe("analytics");
    expect(u.searchParams.get("page_size")).toBe("10");
    for (const gone of ["keyword", "limit", "offset"]) expect(u.searchParams.has(gone)).toBe(false);
  });

  it("list keeps nanosecond *_time values exact", async () => {
    mockFetchText(`{"data":[{"box_id":"b1","create_time":${NANOS}}]}`);
    const res = (await listToolboxes(ctx)) as { data: Array<{ create_time: unknown }> };
    expect(res.data[0]?.create_time).toBe(BigInt(NANOS));
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

  it("tools list forwards the documented filters", async () => {
    const f = mockFetch();
    await listTools(ctx, "b1", {
      name: "add",
      status: "enabled",
      sortBy: "tool_name",
      sortOrder: "desc",
      userId: "u1",
    });
    expect(Object.fromEntries(url(f).searchParams)).toEqual({
      name: "add",
      status: "enabled",
      sort_by: "tool_name",
      sort_order: "desc",
      user_id: "u1",
    });
  });

  it("tools list and tool get keep nanosecond *_time values exact", async () => {
    mockFetchText(`{"tools":[{"tool_id":"t1","update_time":${NANOS}}]}`);
    const list = (await listTools(ctx, "b1")) as { tools: Array<{ update_time: unknown }> };
    expect(list.tools[0]?.update_time).toBe(BigInt(NANOS));
    vi.unstubAllGlobals();
    mockFetchText(`{"tool_id":"t1","create_time":${NANOS}}`);
    const one = (await getTool(ctx, "b1", "t1")) as { create_time: unknown };
    expect(one.create_time).toBe(BigInt(NANOS));
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

describe("toolbox lifecycle", () => {
  it("publish sends status=published", async () => {
    const f = mockFetch();
    await toolboxes(ctx).publish("b1");
    const { url, init, body } = sent(f);
    expect(url.pathname).toBe("/api/agent-operator-integration/v1/tool-box/b1/status");
    expect(init.method).toBe("POST");
    expect(body).toEqual({ status: "published" });
  });

  it("unpublish takes the box offline — the service has no `draft` status", async () => {
    const f = mockFetch();
    await toolboxes(ctx).unpublish("b1");
    expect(sent(f).body).toEqual({ status: "offline" });
  });
});

describe("tool execute / debug transport", () => {
  /** The dispatcher undici was handed, or undefined when the global fetch was used. */
  function headersTimeoutOf(f: typeof fetch): number | undefined {
    const init = sent(f).init as RequestInit & { dispatcher?: unknown };
    const agent = init.dispatcher as Record<symbol, unknown> | undefined;
    if (!agent) return undefined;
    const key = Object.getOwnPropertySymbols(agent).find((s) => String(s).includes("options"));
    return key ? (agent[key] as { headersTimeout?: number }).headersTimeout : undefined;
  }

  it("aborts no sooner than the timeout it asked the service for", async () => {
    const timers = vi.spyOn(globalThis, "setTimeout");
    const f = mockFetch();
    await executeTool(ctx, "b1", "t1", { timeout: 60 });
    expect(sent(f).body.timeout).toBe(60);
    // 60s run + 15s round trip, not the 30s client default.
    expect(timers.mock.calls.map((c) => c[1])).toContain(75_000);
  });

  it("waits out the sandbox maximum when no timeout is given", async () => {
    const f = mockFetch();
    await debugTool(ctx, "b1", "t1");
    expect(sent(f).url.pathname).toBe(
      "/api/agent-operator-integration/v1/tool-box/b1/tool/t1/debug",
    );
    // A function tool sends no header until the run ends, so undici's 300s
    // header deadline has to move with the abort budget.
    expect(headersTimeoutOf(f)).toBe(3600 * 1000 + 15_000);
  });

  it("passes large integers in the upstream body through exactly", async () => {
    mockFetchText(`{"status_code":200,"body":{"result":{"id":${NANOS}}}}`);
    const res = (await executeTool(ctx, "b1", "t1")) as {
      body: { result: { id: unknown } };
    };
    expect(res.body.result.id).toBe(BigInt(NANOS));
  });
});

describe("impex import", () => {
  function adp(): string {
    const file = join(mkdtempSync(join(tmpdir(), "impex-")), "box.adp");
    writeFileSync(file, "{}");
    return file;
  }
  function form(f: typeof fetch): FormData {
    return sent(f).init.body as FormData;
  }

  it("sends mode when given", async () => {
    const f = mockFetch();
    await importConfig(ctx, adp(), "toolbox", { mode: "upsert" });
    expect(sent(f).url.pathname).toBe("/api/agent-operator-integration/v1/impex/import/toolbox");
    expect(form(f).get("mode")).toBe("upsert");
    expect(form(f).get("data")).toBeInstanceOf(Blob);
  });

  it("omits mode otherwise, leaving the service default (create)", async () => {
    const f = mockFetch();
    await toolboxes(ctx).import(adp());
    expect(form(f).has("mode")).toBe(false);
  });
});
