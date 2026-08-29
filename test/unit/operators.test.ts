import { afterEach, describe, expect, it, vi } from "vitest";
import {
  convertOperatorToTool,
  debugOperator,
  deleteOperators,
  getOperatorHistoryDetail,
  listOperatorHistory,
  listOperators,
  registerOperator,
  setOperatorStatus,
  updateOperator,
} from "../../src/api/operators.js";
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
function call(f: typeof fetch): CallArgs {
  const a = (f as unknown as { mock: { calls: CallArgs[] } }).mock.calls[0];
  if (!a) throw new Error("fetch not called");
  return a;
}
afterEach(() => vi.unstubAllGlobals());

describe("operator endpoints", () => {
  it("list maps flags onto the query names the service uses", async () => {
    const f = mockFetch();
    await listOperators(ctx, {
      name: "add",
      status: "published",
      pageSize: 5,
      operatorType: "basic",
      all: true,
    });
    const u = new URL(call(f)[0]);
    expect(u.pathname).toBe("/api/agent-operator-integration/v1/operator/info/list");
    expect(u.searchParams.get("name")).toBe("add");
    expect(u.searchParams.get("status")).toBe("published");
    expect(u.searchParams.get("page_size")).toBe("5");
    expect(u.searchParams.get("operator_type")).toBe("basic");
    expect(u.searchParams.get("all")).toBe("true");
  });

  it("list sends no all= when it was not asked for", async () => {
    const f = mockFetch();
    await listOperators(ctx, { name: "add" });
    expect(new URL(call(f)[0]).searchParams.has("all")).toBe(false);
  });

  it("history without a version lists, with one drills in", async () => {
    const f1 = mockFetch();
    await listOperatorHistory(ctx, "op 1");
    expect(new URL(call(f1)[0]).pathname).toBe(
      "/api/agent-operator-integration/v1/operator/history/op%201",
    );
    vi.unstubAllGlobals();
    const f2 = mockFetch();
    await getOperatorHistoryDetail(ctx, "op1", "v 2");
    expect(new URL(call(f2)[0]).pathname).toBe(
      "/api/agent-operator-integration/v1/operator/history/op1/v%202",
    );
  });

  it("register builds a function operator body with the nested function_input", async () => {
    const f = mockFetch();
    await registerOperator(ctx, {
      metadataType: "function",
      description: "adds two numbers",
      function: {
        name: "add",
        code: "def handler(event):\n    return 1\n",
        inputs: [{ name: "a", type: "number", required: true }],
      },
      directPublish: true,
    });
    const [url, init] = call(f);
    expect(new URL(url).pathname).toBe("/api/agent-operator-integration/v1/operator/register");
    const body = JSON.parse(String(init.body));
    expect(body.operator_metadata_type).toBe("function");
    expect(body.function_input.name).toBe("add");
    expect(body.function_input.script_type).toBe("python");
    expect(body.function_input.inputs).toHaveLength(1);
    // Undescribed parameters still register; the field must exist, not be dropped.
    expect(body.function_input.outputs).toEqual([]);
    expect(body.operator_info.operator_type).toBe("basic");
    expect(body.direct_publish).toBe(true);
  });

  it("register sends an openapi operator as raw data, with no function_input", async () => {
    const f = mockFetch();
    await registerOperator(ctx, { metadataType: "openapi", data: '{"openapi":"3.0.0"}' });
    const body = JSON.parse(String(call(f)[1].body));
    expect(body.data).toBe('{"openapi":"3.0.0"}');
    expect(body.function_input).toBeUndefined();
    expect(body.direct_publish).toBeUndefined();
  });

  it("update posts to info/update with the id alongside the definition", async () => {
    const f = mockFetch();
    await updateOperator(ctx, "op1", { metadataType: "openapi", data: "{}" });
    const [url, init] = call(f);
    expect(new URL(url).pathname).toBe("/api/agent-operator-integration/v1/operator/info/update");
    expect(JSON.parse(String(init.body)).operator_id).toBe("op1");
  });

  it("status posts an array, one entry per operator", async () => {
    const f = mockFetch();
    await setOperatorStatus(ctx, ["a", "b"], "offline");
    const [url, init] = call(f);
    expect(new URL(url).pathname).toBe("/api/agent-operator-integration/v1/operator/status");
    expect(JSON.parse(String(init.body))).toEqual([
      { operator_id: "a", status: "offline" },
      { operator_id: "b", status: "offline" },
    ]);
  });

  it("delete sends DELETE with an array body, not a path id", async () => {
    const f = mockFetch();
    await deleteOperators(ctx, ["a"]);
    const [url, init] = call(f);
    expect(new URL(url).pathname).toBe("/api/agent-operator-integration/v1/operator/delete");
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(String(init.body))).toEqual([{ operator_id: "a" }]);
  });

  it("debug names the version and fills the four request positions", async () => {
    const f = mockFetch();
    await debugOperator(ctx, "op1", { version: "v1", body: { a: 1 } });
    const [url, init] = call(f);
    expect(new URL(url).pathname).toBe("/api/agent-operator-integration/v1/operator/debug");
    const sent = JSON.parse(String(init.body));
    expect(sent).toMatchObject({
      operator_id: "op1",
      version: "v1",
      body: { a: 1 },
      header: {},
      query: {},
      path: {},
    });
  });

  it("convert-to-tool posts the operator and the target box", async () => {
    const f = mockFetch();
    await convertOperatorToTool(ctx, "op1", "box1");
    const [url, init] = call(f);
    expect(new URL(url).pathname).toBe("/api/agent-operator-integration/v1/operator/convert/tool");
    expect(JSON.parse(String(init.body))).toEqual({ operator_id: "op1", box_id: "box1" });
  });
});
