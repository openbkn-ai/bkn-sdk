// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * Execution-factory contract alignment: request shapes the SDK sends and the
 * values the CLI refuses before opening a request.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { executeFunction } from "../../src/api/functions.js";
import { createTool, createToolbox, updateTool } from "../../src/api/toolboxes.js";
import { buildProgram } from "../../src/cli-program.js";
import { metadataBody } from "../../src/commands/skill.js";
import { globalParameterOption, pathParams } from "../../src/commands/toolbox.js";
import type { RequestContext } from "../../src/types.js";
import { InputError } from "../../src/utils/errors.js";
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

function bodyOf(f: typeof fetch): Record<string, unknown> {
  const a = (f as unknown as { mock: { calls: CallArgs[] } }).mock.calls[0];
  if (!a) throw new Error("fetch not called");
  return JSON.parse(String(a[1].body)) as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("tool create / update bodies", () => {
  it("update sends function_input in its edit form, without name or description", async () => {
    const f = mockFetch();
    await updateTool(ctx, "b1", "t1", {
      name: "add",
      description: "adds",
      metadataType: "function",
      function: { name: "add", description: "inner", code: "x" },
    });
    const body = bodyOf(f);
    expect(body).toMatchObject({ name: "add", description: "adds" });
    const input = body.function_input as Record<string, unknown>;
    expect(input).not.toHaveProperty("name");
    expect(input).not.toHaveProperty("description");
    expect(input).toMatchObject({ code: "x", script_type: "python" });
  });

  it("create keeps name and description inside function_input", async () => {
    const f = mockFetch();
    await createTool(ctx, "b1", {
      metadataType: "function",
      function: { name: "add", code: "x" },
    });
    expect(bodyOf(f).function_input).toMatchObject({ name: "add", description: "" });
  });

  it("carries global_parameters (one object) and extend_info when given", async () => {
    const f = mockFetch();
    const gp = { name: "key", description: "api key", in: "header", type: "string" } as const;
    await createTool(ctx, "b1", {
      metadataType: "openapi",
      data: {},
      globalParameters: gp,
      extendInfo: { team: "a" },
    });
    expect(bodyOf(f)).toMatchObject({ global_parameters: gp, extend_info: { team: "a" } });
  });

  it("omits them when not given", async () => {
    const f = mockFetch();
    await createTool(ctx, "b1", { metadataType: "openapi", data: {} });
    expect(bodyOf(f)).not.toHaveProperty("global_parameters");
    expect(bodyOf(f)).not.toHaveProperty("extend_info");
  });
});

describe("toolbox create body", () => {
  it("sends box_category and data only when given", async () => {
    const f = mockFetch();
    await createToolbox(ctx, { name: "n", serviceUrl: "https://s", category: "c1", data: "{}" });
    expect(bodyOf(f)).toMatchObject({ box_category: "c1", data: "{}" });
    vi.unstubAllGlobals();
    const g = mockFetch();
    await createToolbox(ctx, { name: "n", serviceUrl: "https://s" });
    expect(bodyOf(g)).not.toHaveProperty("box_category");
    expect(bodyOf(g)).not.toHaveProperty("data");
  });
});

describe("function execute tracing fields", () => {
  it("maps capability and user marks to their wire names", async () => {
    const f = mockFetch();
    await executeFunction(ctx, {
      code: "x",
      capabilityId: "cap-1",
      capabilityName: "Cap",
      userId: "u-1",
      userName: "User",
    });
    expect(bodyOf(f)).toMatchObject({
      capability_id: "cap-1",
      capability_name: "Cap",
      user_id: "u-1",
      user_name: "User",
    });
  });
});

describe("CLI validators", () => {
  it("refuses non-string --path values and passes strings through", () => {
    expect(() => pathParams({ id: 1 })).toThrow(/--path values must be strings.*'id' is number/);
    expect(() => pathParams({ id: { a: 1 } })).toThrow(InputError);
    expect(pathParams({ id: "o-1" })).toEqual({ id: "o-1" });
    expect(pathParams(undefined)).toBeUndefined();
  });

  it("requires the GlobalParameter fields", () => {
    expect(() => globalParameterOption('{"name":"k"}')).toThrow(/'description'/);
    expect(() => globalParameterOption("[]")).toThrow(/must be a JSON object/);
    expect(
      globalParameterOption('{"name":"k","description":"d","in":"header","type":"string"}'),
    ).toMatchObject({ name: "k", in: "header" });
  });

  it("update-metadata requires name, description, category and a known source", () => {
    expect(() => metadataBody({ name: "n" })).toThrow(/description, category are required/);
    expect(() => metadataBody([])).toThrow(/JSON object/);
    expect(() =>
      metadataBody({ name: "n", description: "d", category: "c", source: "market" }),
    ).toThrow(/source must be one of: custom \| internal/);
    expect(() =>
      metadataBody({ name: "n", description: "d", category: "c", extend_info: [] }),
    ).toThrow(/extend_info must be a JSON object/);
    const ok = { name: "n", description: "d", category: "c", source: "internal" };
    expect(metadataBody(ok)).toEqual(ok);
  });
});

/** Parse argv through the real program; fetch must never be reached. */
async function refused(args: string[]): Promise<Error> {
  const f = vi.fn(async () => {
    throw new Error("fetch must not be called");
  });
  vi.stubGlobal("fetch", f);
  const error = await buildProgram()
    .exitOverride()
    .configureOutput({ writeErr: () => {}, writeOut: () => {} })
    .parseAsync(["--base-url", "https://demo.example.com", "--token", "t", ...args], {
      from: "user",
    })
    .catch((caught: unknown) => caught);
  expect(f).not.toHaveBeenCalled();
  expect(error).toBeInstanceOf(Error);
  return error as Error;
}

describe("CLI refuses out-of-contract values before sending", () => {
  it.each(["abc", "0", "-5", "1.5"])("sandbox run --timeout %s", async (v) => {
    const err = await refused(["sandbox", "run", "-", `--timeout=${v}`]);
    expect(err.message).toMatch(/--timeout must be a positive integer/);
  });

  it("sandbox template --type other than python", async () => {
    const err = await refused(["sandbox", "template", "--type", "node"]);
    expect(err.message).toMatch(/--type must be one of: python/);
  });

  it.each([
    ["export", "b1", "-o", "/tmp/x.adp"],
    ["import", "/tmp/x.adp"],
  ])("toolbox %s --type outside the impex enum", async (...args) => {
    const err = await refused(["toolbox", ...args, "--type", "agent"]);
    expect(err.message).toMatch(/--type must be one of: toolbox \| mcp \| operator/);
  });

  it("tool upload --metadata-type outside the enum", async () => {
    const err = await refused([
      "tool",
      "upload",
      "/tmp/spec.json",
      "--toolbox",
      "b1",
      "--metadata-type",
      "grpc",
    ]);
    expect(err.message).toMatch(/--metadata-type must be one of: openapi \| function/);
  });

  it("tool execute --path with a non-string value", async () => {
    const err = await refused(["tool", "execute", "t1", "--toolbox", "b1", "--path", '{"id":1}']);
    expect(err.message).toMatch(/--path values must be strings/);
  });

  it("skill update-metadata without the required fields", async () => {
    const err = await refused(["skill", "update-metadata", "s1", "--body", '{"name":"n"}']);
    expect(err.message).toMatch(/required/);
  });
});

describe("skill republish wording", () => {
  it("says republish restores into the draft and publishes nothing", () => {
    const skill = buildProgram().commands.find((c) => c.name() === "skill");
    const republish = skill?.commands.find((c) => c.name() === "republish");
    expect(republish?.description()).toMatch(/draft/);
    expect(republish?.description()).toMatch(/publishes nothing/);
  });
});
