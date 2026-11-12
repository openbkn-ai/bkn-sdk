// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { expect, it, vi } from "vitest";
import { buildProgram } from "../../src/cli-program.js";
import { DryRunSignal, enableDryRun } from "../../src/utils/dry-run.js";

it("previews semantic apply without sending the request or probing the server", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  enableDryRun();
  const error = await buildProgram()
    .exitOverride()
    .parseAsync(
      [
        "--base-url",
        "https://semantic-preview.example.com",
        "--token",
        "preview-token",
        "--dry-run",
        "vega",
        "semantic-task",
        "apply",
        "st-1",
        "--apply-mode",
        "force",
      ],
      { from: "user" },
    )
    .catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(DryRunSignal);
  expect((error as DryRunSignal).request).toMatchObject({
    method: "POST",
    url: "https://semantic-preview.example.com/api/vega-backend/v1/semantic-understanding-tasks/st-1/apply",
    headers: { authorization: "<redacted>" },
    body: { apply_mode: "force" },
  });
  expect(fetchMock).not.toHaveBeenCalled();
});
