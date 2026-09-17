// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { expect, it, vi } from "vitest";
import { context } from "../../src/resources/context-loader.js";
import { DryRunSignal, enableDryRun } from "../../src/utils/dry-run.js";

it("previews the direct MCP query arguments without reading schema or opening an MCP session", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  enableDryRun();

  const error = await context({
    baseUrl: "https://query-dry-run.example.com",
    token: "secret-token",
    insecure: false,
  })
    .queryObjectInstance("kn-1", { ot_id: "ot-1", properties: ["name"] })
    .catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(DryRunSignal);
  expect((error as DryRunSignal).request).toMatchObject({
    method: "POST",
    url: "https://query-dry-run.example.com/api/agent-retrieval/v1/mcp",
    headers: { authorization: "<redacted>", "x-kn-id": "kn-1" },
    body: {
      method: "tools/call",
      params: {
        name: "query_object_instance",
      },
    },
  });
  // The preview shows the contract defaults the real call adds (#127).
  expect((error as DryRunSignal).request.body).toMatchObject({
    params: {
      arguments: {
        kn_id: "kn-1",
        response_format: "json",
        ot_id: "ot-1",
        properties: ["name"],
      },
    },
  });
  expect(
    Object.keys(
      (error as { request: { body: { params: { arguments: object } } } }).request.body.params
        .arguments,
    ).sort(),
  ).toEqual(["kn_id", "ot_id", "properties", "response_format"]);
  expect(fetch).not.toHaveBeenCalled();
});

it("previews caller-chosen kn_id and response_format over the defaults", async () => {
  vi.stubGlobal("fetch", vi.fn());
  enableDryRun();

  const error = await context({
    baseUrl: "https://query-dry-run.example.com",
    token: "secret-token",
    insecure: false,
  })
    .queryObjectInstance("kn-1", { ot_id: "ot-1", kn_id: "kn-1", response_format: "toon" })
    .catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(DryRunSignal);
  expect((error as DryRunSignal).request.body).toMatchObject({
    params: { arguments: { kn_id: "kn-1", response_format: "toon", ot_id: "ot-1" } },
  });
});
