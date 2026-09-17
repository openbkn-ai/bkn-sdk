// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClientOptions } from "../../src/types.js";

const { created } = vi.hoisted(() => ({ created: [] as ClientOptions[] }));

vi.mock("../../src/client.js", () => ({
  createClient: vi.fn((opts: ClientOptions) => {
    created.push(opts);
    return { kn: { list: vi.fn(async () => ({ entries: [] })) } };
  }),
}));

import { buildProgram } from "../../src/cli-program.js";
import { resolveContext } from "../../src/config/resolve.js";

afterEach(() => {
  created.length = 0;
  vi.restoreAllMocks();
});

async function run(...argv: string[]): Promise<ClientOptions> {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  await buildProgram().parseAsync(["--json", ...argv, "bkn", "list"], { from: "user" });
  return created[0] as ClientOptions;
}

describe("CLI retry options", () => {
  it("retries by default and reports each retry on stderr", async () => {
    const opts = await run();
    expect(opts.retry).toBe(true);
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    opts.onRetry?.({
      attempt: 1,
      retries: 3,
      delayMs: 500,
      method: "GET",
      url: "https://p.example.com/api/bkn-backend/v1/knowledge-networks?limit=20",
      reason: "ECONNREFUSED",
    });
    expect(err).toHaveBeenCalledWith(
      "openbkn: GET /api/bkn-backend/v1/knowledge-networks failed (ECONNREFUSED); retry 1/3 in 0.5s\n",
    );
  });

  it("--no-retry turns it off, wherever it sits on the line", async () => {
    expect((await run("--no-retry")).retry).toBe(false);
  });

  it("reaches commands that build their own context", async () => {
    const { retryOptionsFrom } = await import("../../src/commands/_shared.js");
    expect(retryOptionsFrom({ retry: false })).toMatchObject({ retry: false });
    expect(retryOptionsFrom({}).retry).toBe(true);
    for (const file of ["call.ts", "admin.ts", "auth.ts"]) {
      const { readFileSync } = await import("node:fs");
      const source = readFileSync(new URL(`../../src/commands/${file}`, import.meta.url), "utf8");
      const direct = source.split("resolveContext({").length - 1;
      const withRetry = source.split("...retryOptionsFrom(g)").length - 1;
      expect(withRetry, file).toBe(direct);
    }
  });

  it("carries retry settings into the request context", () => {
    const onRetry = vi.fn();
    const ctx = resolveContext({
      baseUrl: "https://p.example.com",
      token: "t",
      retry: false,
      onRetry,
    });
    expect(ctx.retry).toBe(false);
    expect(ctx.onRetry).toBe(onRetry);
    expect(resolveContext({ baseUrl: "https://p.example.com", token: "t" }).retry).toBeUndefined();
  });
});
