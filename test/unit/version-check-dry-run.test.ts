// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { describe, expect, it, vi } from "vitest";
import { request } from "../../src/api/http.js";
import { configureVersionCheck } from "../../src/api/version-check.js";
import type { RequestContext } from "../../src/types.js";
import { DryRunSignal, enableDryRun } from "../../src/utils/dry-run.js";

describe("version preflight under --dry-run", () => {
  it("does not probe health and previews the intended business request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    enableDryRun();
    const ctx: RequestContext = {
      baseUrl: "https://demo.example.com",
      token: "token",
      insecure: false,
    };
    configureVersionCheck(ctx, "cli");

    const error = await request(ctx, "/api/vega-backend/v1/catalogs", {
      body: { name: "demo" },
    }).catch((reason) => reason);

    expect(error).toBeInstanceOf(DryRunSignal);
    expect((error as DryRunSignal).request.url).toContain("/api/vega-backend/v1/catalogs");
    expect(fetch).not.toHaveBeenCalled();
  });
});
