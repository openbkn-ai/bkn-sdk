// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { afterEach, describe, expect, it, vi } from "vitest";
import { queryObjectInstance } from "../../src/api/context-loader.js";
import { buildProgram } from "../../src/cli-program.js";
import type { RequestContext } from "../../src/types.js";
import { validateQueryObjectInstanceArgs } from "../../src/utils/query-object-instance-args.js";
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

  it("accepts a recursive condition and valid property-list shape without fetching a schema", () => {
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
});
