import { afterEach, describe, expect, it, vi } from "vitest";
import {
  executeFunction,
  functionTemplate,
  inferFunctionSchema,
  listDependencyVersions,
} from "../../src/api/functions.js";
import type { RequestContext } from "../../src/types.js";

const ctx: RequestContext = {
  baseUrl: "https://demo.example.com",
  token: "t",
  businessDomain: "bd_public",
  insecure: false,
};

type CallArgs = [string, RequestInit];
function mockFetch(body = "{}"): typeof fetch {
  const fn = vi.fn(async () => new Response(body, { status: 200 }));
  vi.stubGlobal("fetch", fn);
  return fn as unknown as typeof fetch;
}
function call(f: typeof fetch): CallArgs {
  const a = (f as unknown as { mock: { calls: CallArgs[] } }).mock.calls[0];
  if (!a) throw new Error("fetch not called");
  return a;
}
afterEach(() => vi.unstubAllGlobals());

describe("function endpoints", () => {
  it("execute posts code and event, and always sends an event", async () => {
    const f = mockFetch();
    await executeFunction(ctx, { code: "def handler(event):\n    return 1\n" });
    const [url, init] = call(f);
    expect(new URL(url).pathname).toBe("/api/agent-operator-integration/v1/function/execute");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    // The field is required by the service; omitting it is a 400, not a default.
    expect(body.event).toEqual({});
    expect(body.code).toContain("handler");
  });

  it("execute carries dependencies and the index only when given", async () => {
    const f = mockFetch();
    await executeFunction(ctx, {
      code: "x",
      dependencies: [{ name: "requests", version: "2.32.3" }],
      dependenciesUrl: "https://mirror.example/simple/",
      timeout: 30,
    });
    const body = JSON.parse(String(call(f)[1].body));
    expect(body.dependencies).toEqual([{ name: "requests", version: "2.32.3" }]);
    expect(body.dependencies_url).toBe("https://mirror.example/simple/");
    expect(body.timeout).toBe(30);
  });

  it("execute omits empty dependency lists rather than sending []", async () => {
    const f = mockFetch();
    await executeFunction(ctx, { code: "x", dependencies: [] });
    expect(Object.keys(JSON.parse(String(call(f)[1].body)))).not.toContain("dependencies");
  });

  it("execute reports a non-zero exit code from a 200 response", async () => {
    mockFetch(JSON.stringify({ exit_code: 1, stderr: "KeyError" }));
    const res = await executeFunction(ctx, { code: "x" });
    expect(res.exit_code).toBe(1);
  });

  it("infer-schema posts only the code", async () => {
    const f = mockFetch();
    await inferFunctionSchema(ctx, "@tool\ndef add(a: int) -> int: ...");
    const [url, init] = call(f);
    expect(new URL(url).pathname).toBe("/api/agent-operator-integration/v1/function/infer-schema");
    expect(JSON.parse(String(init.body))).toEqual({ code: "@tool\ndef add(a: int) -> int: ..." });
  });

  it("dependency versions encodes the package and forwards the index", async () => {
    const f = mockFetch();
    await listDependencyVersions(ctx, "my pkg", {
      pythonVersion: "3.10",
      pypiRepoUrl: "https://mirror.example/simple",
    });
    const u = new URL(call(f)[0]);
    expect(u.pathname).toBe(
      "/api/agent-operator-integration/v1/function/dependency-versions/my%20pkg",
    );
    expect(u.searchParams.get("python_version")).toBe("3.10");
    expect(u.searchParams.get("pypi_repo_url")).toBe("https://mirror.example/simple");
  });

  it("template defaults to python", async () => {
    const f = mockFetch();
    await functionTemplate(ctx);
    expect(new URL(call(f)[0]).pathname).toBe("/api/agent-operator-integration/v1/template/python");
  });
});
