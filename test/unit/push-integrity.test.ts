import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bknCommand } from "../../src/commands/bkn.js";
import { writeVersionCheckCache } from "../../src/config/store.js";
import { kn } from "../../src/resources/knowledge-networks.js";
import type { RequestContext } from "../../src/types.js";
import { lostIndexWarnings, snapshotObjectTypes } from "../../src/utils/push-integrity.js";
import { verifiedContext } from "../setup/verified-context.js";

const BASE = "https://push-integrity.example.com";
const listPath = "/api/bkn-backend/v1/knowledge-networks/kn1/object-types";
const uploadPath = "/api/bkn-backend/v1/bkns";
const dirs: string[] = [];

function packageDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "bkn-push-integrity-"));
  dirs.push(dir);
  mkdirSync(join(dir, "object_types"));
  writeFileSync(
    join(dir, "network.bkn"),
    "---\ntype: knowledge_network\nid: kn1\nname: Test Network\n---\n",
  );
  writeFileSync(
    join(dir, "object_types", "ot.bkn"),
    "---\ntype: object_type\nid: ot\nname: Object Type\n---\n",
  );
  return dir;
}

const before = {
  entries: [
    {
      id: "ot",
      data_source: { type: "resource", id: "resource-1" },
      data_properties: [{ name: "title", condition_operations: ["==", "match", "knn"] }],
    },
  ],
};

function cli(dir: string, extra: string[] = []): Promise<Command> {
  const root = new Command("openbkn")
    .exitOverride()
    .option("--base-url <url>")
    .option("--token <token>")
    .option("--json")
    .option("--no-retry");
  root.addCommand(bknCommand());
  // Failures here stand for state that stays unreadable, not a blip to retry.
  return root.parseAsync(
    [
      "--base-url",
      BASE,
      "--token",
      "t",
      "--json",
      "--no-retry",
      "bkn",
      "push",
      dir,
      "--branch",
      "release",
      ...extra,
    ],
    { from: "user" },
  );
}

function server(...listResponses: Response[]): ReturnType<typeof vi.fn> {
  let read = 0;
  const fetch = vi.fn(async (url: string | URL) => {
    const parsed = new URL(String(url));
    if (parsed.pathname === listPath) {
      expect(parsed.searchParams.get("branch")).toBe("release");
      expect(parsed.searchParams.get("limit")).toBe("-1");
      const response = listResponses[read];
      read += 1;
      if (!response) throw new Error("unexpected list read");
      return response;
    }
    if (parsed.pathname === uploadPath) {
      expect(parsed.searchParams.get("branch")).toBe("release");
      return Response.json({ id: "kn1" });
    }
    throw new Error(`unexpected request ${parsed.pathname}`);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

beforeEach(() => {
  writeVersionCheckCache(BASE, { serverVersion: "0.1.5", checkedAt: new Date().toISOString() });
});

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("bkn push integrity verification", () => {
  it("warns on lost binding and operators after the upload", async () => {
    const fetch = server(
      Response.json(before),
      Response.json({
        entries: [
          {
            id: "ot",
            data_source: null,
            data_properties: [{ name: "title", condition_operations: ["=="] }],
          },
        ],
      }),
    );
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((part) => {
      stdout.push(String(part));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((part) => {
      stderr.push(String(part));
      return true;
    });

    await cli(packageDir());

    const paths = fetch.mock.calls.map(([url]) => new URL(String(url)).pathname);
    expect(paths).toEqual([listPath, uploadPath, listPath]);
    expect(stderr.join("")).toContain("Object type 'ot' lost its data_source binding");
    expect(stderr.join("")).toContain(
      "property 'title' lost condition_operations after push: match, knn",
    );
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      id: "kn1",
      integrity_warnings: expect.arrayContaining([
        expect.stringContaining("lost its data_source binding"),
        expect.stringContaining("match, knn"),
      ]),
    });
  });

  it("keeps an unchanged push response free of integrity warnings", async () => {
    const fetch = server(Response.json(before), Response.json(before));
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await cli(packageDir());
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(stderr).not.toHaveBeenCalled();
  });

  it("lets a new branch push proceed when there is no previous network", async () => {
    const fetch = server(Response.json({ error: "not found" }, { status: 404 }));
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await cli(packageDir());
    expect(fetch.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      listPath,
      uploadPath,
    ]);
  });

  it("reports an unreadable post-upload snapshot instead of claiming verification", async () => {
    server(Response.json(before), Response.json({ error: "offline" }, { status: 503 }));
    const stdout: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((part) => {
      stdout.push(String(part));
      return true;
    });
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await cli(packageDir());
    expect(stderr.mock.calls.join(" ")).toContain(
      "Could not verify object-type bindings/index operators",
    );
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      id: "kn1",
      integrity_warnings: [expect.stringContaining("Could not verify")],
    });
  });

  it("reports an incomplete post-upload snapshot instead of claiming verification", async () => {
    server(Response.json(before), Response.json({ entries: [{ id: "ot" }] }));
    const stdout: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((part) => {
      stdout.push(String(part));
      return true;
    });
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await cli(packageDir());

    expect(stderr.mock.calls.join(" ")).toContain(
      "Could not verify object-type bindings/index operators",
    );
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      integrity_warnings: [expect.stringContaining("Could not verify")],
    });
  });

  it.each([
    Response.json({ error: "offline" }, { status: 503 }),
    Response.json({ wrong: "shape" }),
    Response.json({ entries: [{ id: "ot", data_source: {} }] }),
    Response.json({ entries: [{ id: "ot", data_source: null, data_properties: null }] }),
  ])("refuses to upload when the before-snapshot is unreadable", async (response) => {
    const fetch = server(response);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await expect(cli(packageDir())).rejects.toThrow();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("reads an object type without a data_properties key as having none", () => {
    // bkn-backend serializes data_properties with `omitempty`.
    const snapshot = snapshotObjectTypes({ entries: [{ id: "ot", data_source: null }] });
    expect(snapshot.get("ot")?.properties.size).toBe(0);
  });

  it("pushes a network whose object type has no data properties", async () => {
    const bare = { entries: [{ id: "ot", data_source: { type: "resource", id: "resource-1" } }] };
    const fetch = server(Response.json(bare), Response.json(bare));
    const stdout: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((part) => {
      stdout.push(String(part));
      return true;
    });
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await cli(packageDir());

    expect(fetch.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      listPath,
      uploadPath,
      listPath,
    ]);
    expect(stderr).not.toHaveBeenCalled();
    expect(JSON.parse(stdout.join(""))).not.toHaveProperty("integrity_warnings");
  });

  it("reads a data_source without an id as unbound, as the contract allows", () => {
    // DataSource.required is [type]; an id-less source must not abort the push.
    const snapshot = snapshotObjectTypes({
      entries: [{ id: "ot", data_source: { type: "resource" }, data_properties: [] }],
    });
    expect(snapshot.get("ot")?.dataSourceId).toBeUndefined();
    const empty = snapshotObjectTypes({
      entries: [{ id: "ot", data_source: { type: "resource", id: "" } }],
    });
    expect(empty.get("ot")?.dataSourceId).toBeUndefined();
    expect(() =>
      snapshotObjectTypes({ entries: [{ id: "ot", data_source: { type: "resource", id: 7 } }] }),
    ).toThrow("invalid data_source");
  });

  it("rejects an undefined binding in a snapshot", () => {
    expect(() =>
      snapshotObjectTypes({
        entries: [{ id: "ot", data_source: undefined, data_properties: [] }],
      }),
    ).toThrow("invalid data_source");
  });

  it("warns and uploads when the pre-push read is forbidden", async () => {
    const fetch = server(Response.json({ message: "missing view_detail" }, { status: 403 }));
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((part) => {
      stdout.push(String(part));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((part) => {
      stderr.push(String(part));
      return true;
    });

    await cli(packageDir());

    expect(fetch.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      listPath,
      uploadPath,
    ]);
    expect(stderr.join("")).toContain("warning: integrity not verified: ");
    expect(stderr.join("")).toContain("HTTP 403");
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      id: "kn1",
      integrity_warnings: [expect.stringMatching(/^integrity not verified: .*HTTP 403/)],
    });
  });

  it("returns integrity_warnings from the SDK when the pre-push read is unauthorized", async () => {
    const fetch = server(Response.json({ message: "token expired" }, { status: 401 }));
    const seen: string[] = [];

    const result = await kn(
      verifiedContext<RequestContext>({ baseUrl: BASE, token: "t", insecure: false }),
    ).push(packageDir(), { branch: "release", onIntegrityWarning: (w) => seen.push(w) });

    expect(fetch.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      listPath,
      uploadPath,
    ]);
    expect(seen).toEqual([expect.stringMatching(/^integrity not verified: .*HTTP 401/)]);
    expect(result).toEqual({ id: "kn1", integrity_warnings: seen });
  });

  it("warns when an indexed object type disappears from the post-push list", () => {
    expect(
      lostIndexWarnings(snapshotObjectTypes(before), snapshotObjectTypes({ entries: [] })),
    ).toEqual([
      "Object type 'ot' disappeared after push; its binding/index state was not preserved.",
    ]);
  });

  it("treats a binding dropped under --binding-policy detach as expected", async () => {
    const fetch = server(
      Response.json(before),
      Response.json({
        entries: [
          {
            id: "ot",
            data_source: null,
            data_properties: [{ name: "title", condition_operations: [] }],
          },
        ],
      }),
    );
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((part) => {
      stdout.push(String(part));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((part) => {
      stderr.push(String(part));
      return true;
    });

    await cli(packageDir(), ["--binding-policy", "detach"]);

    const upload = fetch.mock.calls
      .map(([url]) => new URL(String(url)))
      .find((url) => url.pathname === uploadPath);
    expect(upload?.searchParams.get("binding_policy")).toBe("detach");
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(stderr.join("")).not.toContain("data_source");
    expect(stderr.join("")).not.toContain("condition_operations");
    const out = JSON.parse(stdout.join(""));
    expect(out).toEqual({ id: "kn1" });
  });

  it("still reports detach-unrelated losses under the detach policy", () => {
    const changed = {
      entries: [
        {
          id: "ot",
          data_source: { type: "resource", id: "resource-2" },
          data_properties: [{ name: "title", condition_operations: ["=="] }],
        },
      ],
    };
    const policy = { bindingPolicy: "detach" as const };
    expect(
      lostIndexWarnings(snapshotObjectTypes(before), snapshotObjectTypes(changed), policy),
    ).toEqual([
      "Object type 'ot' changed its data_source binding after push: resource-1 -> resource-2.",
      "Object type 'ot' property 'title' lost condition_operations after push: match, knn.",
    ]);
    expect(
      lostIndexWarnings(snapshotObjectTypes(before), snapshotObjectTypes({ entries: [] }), policy),
    ).toEqual([
      "Object type 'ot' disappeared after push; its binding/index state was not preserved.",
    ]);
  });

  it("warns when a binding changes to another resource", () => {
    const after = {
      entries: [
        {
          id: "ot",
          data_source: { type: "resource", id: "resource-2" },
          data_properties: [{ name: "title", condition_operations: ["==", "match", "knn"] }],
        },
      ],
    };
    expect(lostIndexWarnings(snapshotObjectTypes(before), snapshotObjectTypes(after))).toEqual([
      "Object type 'ot' changed its data_source binding after push: resource-1 -> resource-2.",
    ]);
  });
});
