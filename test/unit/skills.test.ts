import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteSkill,
  executeSkill,
  getSkill,
  getSkillContent,
  getSkillNames,
  listSkillMarket,
  listSkills,
  readSkillFile,
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
