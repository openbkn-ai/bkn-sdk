// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryObjectInstance } from "../../src/api/context-loader.js";
import { buildProgram } from "../../src/cli-program.js";
import { context } from "../../src/resources/context-loader.js";
import type { RequestContext } from "../../src/types.js";
import {
  validateQueryObjectInstanceArgs,
  validateRequestedProperties,
} from "../../src/utils/query-object-instance-args.js";
import { verifiedContext } from "../setup/verified-context.js";

const ctx = verifiedContext<RequestContext>({
  baseUrl: "https://query-args.example.com",
  token: "t",
  insecure: false,
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("query_object_instance argument validation", () => {
  it.each([
    [{ ot_id: "ot-1", knn: { field: "embedding" } }, "condition.operation=knn"],
    [{ ot_id: "ot-1", sort_by: "created_at" }, "sort_by"],
    [
      { ot_id: "ot-1", condition: { operation: "and", conditions: [] } },
      "condition.sub_conditions",
    ],
    [
      {
        ot_id: "ot-1",
        condition: { field: "status", operation: "==", value_from: "const", value: "open" },
        filters: [{ field: "region", op: "==", value: "CN" }],
      },
      "the platform ignores filters",
    ],
    [{ ot_id: "ot-1", cursor: "next-page", offset: 30 }, "cursor and offset cannot be combined"],
    [{ ot_id: "ot-1", kn_id: "another-kn" }, "kn_id must match"],
    [
      {
        ot_id: "ot-1",
        condition: {
          operation: "and",
          sub_conditions: [{ operation: "or", conditions: [] }],
        },
      },
      "condition.sub_conditions[0].sub_conditions",
    ],
    [
      { ot_id: "ot-1", filters: [{ field: "name", op: "==", value: "pod", negate: true }] },
      "filters[0] argument negate",
    ],
    [
      { ot_id: "ot-1", sort: [{ field: "created_at", direction: "desc", nulls: "last" }] },
      "sort[0] argument nulls",
    ],
  ] as const)("rejects silently ignored arguments before any SDK request: %j", (args, hint) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    expect(() => queryObjectInstance(ctx, "kn-1", args)).toThrow(hint);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['{"ot_id":"ot-1","knn":{"field":"embedding"}}', "condition.operation=knn"],
    [
      '{"ot_id":"ot-1","condition":{"operation":"and","conditions":[]}}',
      "condition.sub_conditions",
    ],
    [
      '{"ot_id":"ot-1","condition":{"field":"status","operation":"==","value_from":"const","value":"open"},"filters":[{"field":"region","op":"==","value":"CN"}]}',
      "the platform ignores filters",
    ],
    ['{"ot_id":"ot-1","cursor":"next-page","offset":30}', "cursor and offset cannot be combined"],
    ['{"ot_id":"ot-1","kn_id":"another-kn"}', "kn_id must match"],
    [
      '{"ot_id":"ot-1","filters":[{"field":"name","op":"==","value":"pod","negate":true}]}',
      "filters[0] argument negate",
    ],
    [
      '{"ot_id":"ot-1","sort":[{"field":"created_at","direction":"desc","nulls":"last"}]}',
      "sort[0] argument nulls",
    ],
  ])("runs the real CLI command and rejects %s before any request", async (args, hint) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await expect(
      buildProgram().parseAsync(
        [
          "--base-url",
          ctx.baseUrl,
          "--token",
          ctx.token,
          "context",
          "query-object-instance",
          "kn-1",
          "--args",
          args,
        ],
        { from: "user" },
      ),
    ).rejects.toThrow(hint);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requires a JSON object, an object type id, and an array of property names", () => {
    expect(() => validateQueryObjectInstanceArgs([] as unknown as Record<string, unknown>)).toThrow(
      "--args must be a JSON object",
    );
    expect(() => validateQueryObjectInstanceArgs({ properties: ["name"] })).toThrow("ot_id");
    expect(() => validateQueryObjectInstanceArgs({ ot_id: "ot-1", properties: "name" })).toThrow(
      "properties must be an array",
    );
  });

  it("requires filter and sort item fields and valid sort directions", () => {
    expect(() => validateQueryObjectInstanceArgs({ ot_id: "ot-1", filters: {} })).toThrow(
      "filters must be a JSON array",
    );
    expect(() => validateQueryObjectInstanceArgs({ ot_id: "ot-1", filters: [null] })).toThrow(
      "filters[0] must be a JSON object",
    );
    expect(() =>
      validateQueryObjectInstanceArgs({ ot_id: "ot-1", filters: [{ field: "name", value: 0 }] }),
    ).toThrow("filters[0].op is required");
    expect(() =>
      validateQueryObjectInstanceArgs({ ot_id: "ot-1", filters: [{ field: "name", op: "==" }] }),
    ).toThrow("filters[0].value is required");
    expect(() =>
      validateQueryObjectInstanceArgs({
        ot_id: "ot-1",
        filters: [{ field: "name", op: "==", value: undefined }],
      }),
    ).toThrow("filters[0].value is required");
    expect(() => validateQueryObjectInstanceArgs({ ot_id: "ot-1", sort: {} })).toThrow(
      "sort must be a JSON array",
    );
    expect(() =>
      validateQueryObjectInstanceArgs({ ot_id: "ot-1", sort: [{ direction: "asc" }] }),
    ).toThrow("sort[0].field is required");
    expect(() =>
      validateQueryObjectInstanceArgs({
        ot_id: "ot-1",
        sort: [{ field: "name", direction: "up" }],
      }),
    ).toThrow("sort[0].direction must be asc or desc");
  });

  it("accepts filter and sort item shapes with zero and descending order", () => {
    expect(() =>
      validateQueryObjectInstanceArgs({
        ot_id: "ot-1",
        filters: [{ field: "qty", op: "==", value: 0 }],
        sort: [{ field: "qty", direction: "desc" }],
      }),
    ).not.toThrow();
  });

  it("accepts a recursive condition and valid property-list shape", () => {
    expect(() =>
      validateQueryObjectInstanceArgs({
        ot_id: "ot-1",
        limit: 5,
        properties: ["name", "embedding"],
        condition: {
          operation: "or",
          sub_conditions: [
            { field: "name", operation: "match", value_from: "const", value: "pod" },
            {
              field: "embedding",
              operation: "knn",
              value_from: "const",
              value: "pod",
              limit_key: "k",
              limit_value: 5,
            },
          ],
        },
      }),
    ).not.toThrow();
  });

  it("reads the object-type schema once and rejects unknown fields before any MCP query", async () => {
    const fetch = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            entries: [
              {
                id: "ot-1",
                data_properties: [{ name: "name" }],
                logic_properties: [{ name: "score" }],
              },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(
      context(ctx).queryObjectInstance("kn-1", { ot_id: "ot-1", properties: ["naem"] }),
    ).rejects.toThrow("has no queryable data property 'naem'. Available: name");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0]?.[0])).toContain(
      "/knowledge-networks/kn-1/object-types/ot-1",
    );
    expect(fetch.mock.calls[0]?.[1]?.method).toBe("GET");
  });

  it("fails closed when the schema response does not expose the requested object type", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ entries: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    await expect(
      context(ctx).queryObjectInstance("kn-1", { ot_id: "ot-1", properties: ["name"] }),
    ).rejects.toThrow("its schema is not visible");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("runs the CLI schema check and rejects an unknown field before any MCP request", async () => {
    const configDir = mkdtempSync(join(tmpdir(), "bkn-query-schema-"));
    const previousConfigDir = process.env.BKN_CONFIG_DIR;
    process.env.BKN_CONFIG_DIR = configDir;
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      return new Response(
        JSON.stringify(
          path.endsWith("/health")
            ? { ServerVersion: "0.1.5" }
            : { entries: [{ id: "ot-1", data_properties: [{ name: "name" }] }] },
        ),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetch);

    try {
      await expect(
        buildProgram().parseAsync(
          [
            "--base-url",
            ctx.baseUrl,
            "--token",
            ctx.token,
            "context",
            "query-object-instance",
            "kn-1",
            "--args",
            '{"ot_id":"ot-1","properties":["naem"]}',
          ],
          { from: "user" },
        ),
      ).rejects.toThrow("has no queryable data property 'naem'");
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(fetch.mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual([
        "/api/bkn-backend/v1/health",
        "/api/bkn-backend/v1/knowledge-networks/kn-1/object-types/ot-1",
      ]);
    } finally {
      if (previousConfigDir === undefined) delete process.env.BKN_CONFIG_DIR;
      else process.env.BKN_CONFIG_DIR = previousConfigDir;
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it("checks static arguments before attempting the schema read", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await expect(
      context(ctx).queryObjectInstance("kn-1", {
        ot_id: "ot-1",
        properties: ["name"],
        sort_by: "name",
      }),
    ).rejects.toThrow("sort_by");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepts data property names and directs logic property names to their dedicated query", () => {
    const schema = {
      entries: [
        {
          id: "ot-1",
          data_properties: [{ name: "name" }],
          logic_properties: [{ name: "score" }],
        },
      ],
    };
    expect(() => validateRequestedProperties("ot-1", ["name"], schema)).not.toThrow();
    expect(() => validateRequestedProperties("ot-1", ["score"], schema)).toThrow(
      "Use get-logic-properties for computed fields",
    );
  });
});
