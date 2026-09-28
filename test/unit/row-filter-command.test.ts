import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import { adminCommand } from "../../src/commands/admin.js";
import { writeVersionCheckCache } from "../../src/config/store.js";

const BASE = "https://demo.example.com";

function cli(): Command {
  const root = new Command("openbkn")
    .exitOverride()
    .option("--base-url <url>")
    .option("--token <t>")
    .option("--json");
  root.addCommand(adminCommand());
  return root;
}

function run(args: string[]): Promise<Command> {
  return cli().parseAsync(["--base-url", BASE, "--token", "t", "admin", "row-filter", ...args], {
    from: "user",
  });
}

const emptySnapshot = {
  object_type_ref: "sales/order",
  subject: { type: "user", id: "user-1" },
  policy: null,
  revision: null,
  available_fields: [{ display_name: "Region", name: "region", type: "string" }],
};

function mockFetch(body: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const callAt = (fetchMock: ReturnType<typeof vi.fn>, index = 0) =>
  fetchMock.mock.calls[index] as [string, RequestInit];

beforeEach(() => {
  writeVersionCheckCache(BASE, { serverVersion: pkg.version, checkedAt: new Date().toISOString() });
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("admin row-filter command", () => {
  it("get sends the selected user and object type as query parameters", async () => {
    const fetchMock = mockFetch(emptySnapshot);

    await run([
      "get",
      "--object-type",
      "sales/order",
      "--subject-type",
      "user",
      "--subject-id",
      "user-1",
    ]);

    const url = new URL(callAt(fetchMock)[0]);
    expect(url.pathname).toBe("/api/safe/v1/admin/row-filter-policies");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      object_type_ref: "sales/order",
      subject_type: "user",
      subject_id: "user-1",
    });
  });

  it("apply sends policy JSON with an explicit optimistic-lock revision", async () => {
    const fetchMock = mockFetch({ ...emptySnapshot, revision: "AAAAAAAAAAI" });

    await run([
      "apply",
      "--object-type",
      "sales/order",
      "--subject-type",
      "role",
      "--subject-id",
      "sales-east",
      "--expected-revision",
      "AAAAAAAAAAE",
      "--reason",
      "Regional restriction",
      "--body",
      '{"relation":"and","conditions":[{"propertyName":"region","operator":"in","values":["east"]}]}',
    ]);

    const [, init] = callAt(fetchMock);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({
      object_type_ref: "sales/order",
      subject: { type: "role", id: "sales-east" },
      expected_revision: "AAAAAAAAAAE",
      policy: {
        relation: "and",
        conditions: [{ property_name: "region", operator: "in", values: ["east"] }],
      },
      reason: "Regional restriction",
    });
  });

  it.each(["null", "0", "false"])(
    "apply rejects a non-object body %s instead of deleting the policy",
    async (body) => {
      const fetchMock = mockFetch(emptySnapshot);

      await expect(
        run([
          "apply",
          "--object-type",
          "sales/order",
          "--subject-type",
          "user",
          "--subject-id",
          "user-1",
          "--reason",
          "Apply a restriction",
          "--body",
          body,
        ]),
      ).rejects.toThrow(/non-null row-filter policy JSON object/);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("delete sends policy null instead of inventing a deny-all policy", async () => {
    const fetchMock = mockFetch(emptySnapshot);

    await run([
      "delete",
      "--object-type",
      "sales/order",
      "--subject-type",
      "user",
      "--subject-id",
      "user-1",
      "--expected-revision",
      "AAAAAAAAAAE",
      "--reason",
      "Remove obsolete restriction",
    ]);

    expect(JSON.parse(String(callAt(fetchMock)[1].body))).toMatchObject({
      expected_revision: "AAAAAAAAAAE",
      policy: null,
    });
  });

  it("explain calls only the bearer-token-protected management endpoint", async () => {
    const fetchMock = mockFetch({ snapshot: emptySnapshot, role_policy_only: false });

    await run([
      "explain",
      "--object-type",
      "sales/order",
      "--subject-type",
      "user",
      "--subject-id",
      "user-1",
    ]);

    const [url, init] = callAt(fetchMock);
    expect(new URL(url).pathname).toBe("/api/safe/v1/admin/row-filter-policies/explain");
    expect(init.method).toBe("POST");
    expect(url).not.toContain("/authz/row-filters");
  });
});
