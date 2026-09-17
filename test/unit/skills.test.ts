import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteSkill,
  executeSkill,
  getSkill,
  getSkillContent,
  getSkillHistory,
  getSkillMarket,
  getSkillNames,
  listSkillMarket,
  listSkills,
  readSkillFile,
  registerSkillZip,
  setSkillStatus,
} from "../../src/api/skills.js";
import type { RequestContext } from "../../src/types.js";
import { verifiedContext } from "../setup/verified-context.js";

const ctx = verifiedContext<RequestContext>({
  baseUrl: "https://demo.example.com",
  token: "t",
  insecure: false,
});

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

describe("published vs draft reads", () => {
  it("content hits the consumer path by default and management with draft", async () => {
    const f1 = mockFetch();
    await getSkillContent(ctx, "s1");
    expect(new URL(firstCall(f1)[0]).pathname).toBe(
      "/api/agent-operator-integration/v1/skills/s1/content",
    );
    vi.unstubAllGlobals();
    const f2 = mockFetch();
    await getSkillContent(ctx, "s1", { view: "draft" });
    expect(new URL(firstCall(f2)[0]).pathname).toBe(
      "/api/agent-operator-integration/v1/skills/s1/management/content",
    );
  });

  it("read-file posts rel_path and carries response_mode", async () => {
    const f = mockFetch();
    await readSkillFile(ctx, "s1", "styles/tokens.json", {
      view: "draft",
      responseMode: "content",
    });
    const [url, init] = firstCall(f);
    expect(new URL(url).pathname).toBe(
      "/api/agent-operator-integration/v1/skills/s1/management/files/read",
    );
    expect(new URL(url).searchParams.get("response_mode")).toBe("content");
    expect(JSON.parse(init.body as string)).toEqual({ rel_path: "styles/tokens.json" });
  });
});

describe("executeSkill", () => {
  it("posts entry_shell + timeout", async () => {
    const f = mockFetch();
    await executeSkill(ctx, "s1", { entryShell: "python run.py", timeout: 30 });
    const [url, init] = firstCall(f);
    expect(new URL(url).pathname).toBe("/api/agent-operator-integration/v1/skills/s1/execute");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      entry_shell: "python run.py",
      timeout: 30,
    });
  });

  it("omits timeout when unset, so the backend default applies", async () => {
    const f = mockFetch();
    await executeSkill(ctx, "s1", { entryShell: "ls" });
    expect(JSON.parse(firstCall(f)[1].body as string)).toEqual({ entry_shell: "ls" });
  });
});

describe("getSkillNames", () => {
  it("posts the ids under `ids`, not `skill_ids`", async () => {
    const f = mockFetch();
    await getSkillNames(ctx, ["a", "b"]);
    const [url, init] = firstCall(f);
    expect(new URL(url).pathname).toBe("/api/agent-operator-integration/v1/skills/names");
    expect(JSON.parse(init.body as string)).toEqual({ ids: ["a", "b"] });
  });
});

describe("executeSkill transport budget", () => {
  /** The dispatcher undici was handed, or undefined when the global fetch was used. */
  function dispatcherOf(f: typeof fetch): { headersTimeout?: number } | undefined {
    const calls = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    const init = calls[0]?.[1] as (RequestInit & { dispatcher?: unknown }) | undefined;
    const agent = init?.dispatcher as Record<symbol, unknown> | undefined;
    if (!agent) return undefined;
    const key = Object.getOwnPropertySymbols(agent).find((s) => String(s).includes("options"));
    return key ? (agent[key] as { headersTimeout?: number }) : {};
  }

  it("raises the header deadline past undici's 300s wall when no limit is given", async () => {
    const f = mockFetch();
    await executeSkill(ctx, "s1", { entryShell: "run.sh" });
    // `execute-sync` blocks and sends no headers until the run ends, so an
    // AbortController deadline alone tops out at 300s no matter how large.
    expect(dispatcherOf(f)?.headersTimeout).toBe(3600 * 1000 + 15_000);
  });

  it("stays on the platform fetch for a budget it already honours", async () => {
    const f = mockFetch();
    await executeSkill(ctx, "s1", { entryShell: "run.sh", timeout: 60 });
    // 75s is well under the wall — detouring would cost interceptability for
    // nothing.
    expect(dispatcherOf(f)).toBeUndefined();
  });
});

describe("skill list filters follow the contract", () => {
  it("list sends category/sort/all/status and never `source`", async () => {
    const f = mockFetch();
    await listSkills(ctx, {
      name: "demo",
      category: "data",
      createUser: "alice",
      status: "published",
      sortBy: "create_time",
      sortOrder: "asc",
      all: true,
      // A caller on the old type: the service never had a `source` filter.
      ...({ source: "custom" } as object),
    });
    const q = new URL(firstCall(f)[0]).searchParams;
    expect(Object.fromEntries(q)).toEqual({
      page: "1",
      page_size: "30",
      name: "demo",
      category: "data",
      create_user: "alice",
      status: "published",
      sort_by: "create_time",
      sort_order: "asc",
      all: "true",
    });
  });

  it("market never sends status — everything there is published", async () => {
    const f = mockFetch();
    await listSkillMarket(ctx, { category: "data", ...({ status: "offline" } as object) });
    const q = new URL(firstCall(f)[0]).searchParams;
    expect(q.get("category")).toBe("data");
    expect(q.has("status")).toBe(false);
    expect(q.has("source")).toBe(false);
  });
});

describe("skill reads keep nanosecond *_time values exact", () => {
  const NANOS = "1784431697368964901";
  const cases: Array<[string, () => Promise<unknown>]> = [
    ["list", () => listSkills(ctx)],
    ["market", () => listSkillMarket(ctx)],
    ["get", () => getSkill(ctx, "s1")],
    ["market-get", () => getSkillMarket(ctx, "s1")],
    ["history", () => getSkillHistory(ctx, "s1")],
  ];
  it.each(cases)("%s", async (_name, call) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(`{"update_time":${NANOS}}`, { status: 200 })),
    );
    // `JSON.parse` would round this to 1784431697368964900.
    expect(((await call()) as { update_time: unknown }).update_time).toBe(BigInt(NANOS));
  });
});

describe("skill status and register", () => {
  it("set-status PUTs the target status", async () => {
    const f = mockFetch();
    await setSkillStatus(ctx, "s1", "offline");
    const [u, init] = firstCall(f);
    expect(new URL(u).pathname).toBe("/api/agent-operator-integration/v1/skills/s1/status");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ status: "offline" });
  });

  it("register sends category as a form field when given", async () => {
    const f = mockFetch();
    await registerSkillZip(ctx, new Uint8Array([1]), { category: "data" });
    const form = firstCall(f)[1].body as FormData;
    expect(form.get("category")).toBe("data");
    expect(form.get("file_type")).toBe("zip");
  });

  it("register omits category otherwise, leaving the service default", async () => {
    const f = mockFetch();
    await registerSkillZip(ctx, new Uint8Array([1]));
    expect((firstCall(f)[1].body as FormData).has("category")).toBe(false);
  });
});
