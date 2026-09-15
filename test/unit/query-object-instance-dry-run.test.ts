// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { expect, it, vi } from "vitest";
import { context } from "../../src/resources/context-loader.js";
import { DryRunSignal, enableDryRun } from "../../src/utils/dry-run.js";

it("previews the query arguments without reading schema or opening an MCP session", async () => {
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
        arguments: { ot_id: "ot-1", kn_id: "kn-1", properties: ["name"] },
      },
    },
  });
  expect(fetch).not.toHaveBeenCalled();
});
