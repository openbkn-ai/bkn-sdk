import { afterEach, describe, expect, it, vi } from "vitest";
import {
  explainRowFilterPolicySafe,
  getRowFilterPolicySafe,
  patchRowFilterPolicySafe,
} from "../../src/api/safe.js";
import type { RequestContext } from "../../src/types.js";
import { verifiedContext } from "../setup/verified-context.js";

const ctx = verifiedContext<RequestContext>({
  baseUrl: "https://demo.example.com",
  token: "t",
  insecure: false,
});

type Call = [string, RequestInit];

function mockFetch(body: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function call(fetchMock: ReturnType<typeof vi.fn>): Call {
  const found = fetchMock.mock.calls[0] as Call | undefined;
  if (!found) throw new Error("fetch not called");
  return found;
}

const target = {
  objectTypeRef: "sales/order",
  subject: { type: "user" as const, id: "user-1" },
};

const snapshotWire = {
  object_type_ref: "sales/order",
  subject: { type: "user", id: "user-1" },
  policy: {
    relation: "and",
    conditions: [{ property_name: "region", operator: "in", values: ["east"] }],
  },
  revision: "AAAAAAAAAAE",
  available_fields: [{ display_name: "Sales region", name: "region", type: "string" }],
};

afterEach(() => vi.unstubAllGlobals());

describe("row-filter management API", () => {
  it("gets one policy with canonical query names and maps the snapshot", async () => {
    const fetchMock = mockFetch(snapshotWire);

    const snapshot = await getRowFilterPolicySafe(ctx, target);

    const url = new URL(call(fetchMock)[0]);
    expect(url.pathname).toBe("/api/safe/v1/admin/row-filter-policies");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      object_type_ref: "sales/order",
      subject_type: "user",
      subject_id: "user-1",
    });
    expect(snapshot).toEqual({
      objectTypeRef: "sales/order",
      subject: { type: "user", id: "user-1" },
      policy: {
        relation: "and",
        conditions: [{ propertyName: "region", operator: "in", values: ["east"] }],
      },
      revision: "AAAAAAAAAAE",
      availableFields: [{ displayName: "Sales region", name: "region", type: "string" }],
    });
  });

  it("patches camelCase SDK input as the exact snake_case wire contract", async () => {
    const fetchMock = mockFetch(snapshotWire);

    await patchRowFilterPolicySafe(ctx, {
      ...target,
      expectedRevision: "AAAAAAAAAAE",
      policy: {
        relation: "or",
        conditions: [
          { propertyName: "priority", operator: "between", values: [3, 8] },
          { propertyName: "active", operator: "in", values: [true, false] },
        ],
      },
      reason: "Adjust order visibility",
    });

    const [, init] = call(fetchMock);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({
      object_type_ref: "sales/order",
      subject: { type: "user", id: "user-1" },
      expected_revision: "AAAAAAAAAAE",
      policy: {
        relation: "or",
        conditions: [
          { property_name: "priority", operator: "between", values: [3, 8] },
          { property_name: "active", operator: "in", values: [true, false] },
        ],
      },
      reason: "Adjust order visibility",
    });
  });

  it("sends policy null for an optimistic deletion", async () => {
    const fetchMock = mockFetch({ ...snapshotWire, policy: null, revision: null });

    await patchRowFilterPolicySafe(ctx, {
      ...target,
      expectedRevision: "AAAAAAAAAAE",
      policy: null,
      reason: "Remove obsolete restriction",
    });

    expect(JSON.parse(String(call(fetchMock)[1].body))).toMatchObject({
      expected_revision: "AAAAAAAAAAE",
      policy: null,
    });
  });

  it("maps effective predicates and role policy sources from explain", async () => {
    mockFetch({
      snapshot: snapshotWire,
      role_policy_only: false,
      effective_predicate: {
        kind: "or",
        predicates: [
          { kind: "in", property: "region", values: ["east"] },
          { kind: "gte", property: "priority", values: [8] },
        ],
      },
      effective_row_filter_digest: "sha256:digest",
      direct_policy: snapshotWire.policy,
      role_policies: [
        {
          subject: { type: "role", id: "priority-support" },
          policy: {
            relation: "and",
            conditions: [{ property_name: "priority", operator: "gte", values: [8] }],
          },
        },
      ],
    });

    const explanation = await explainRowFilterPolicySafe(ctx, target);

    expect(explanation.rolePolicyOnly).toBe(false);
    expect(explanation.effectivePredicate).toEqual({
      kind: "or",
      predicates: [
        { kind: "in", property: "region", values: ["east"] },
        { kind: "gte", property: "priority", values: [8] },
      ],
    });
    expect(explanation.rolePolicies?.[0]).toEqual({
      subject: { type: "role", id: "priority-support" },
      policy: {
        relation: "and",
        conditions: [{ propertyName: "priority", operator: "gte", values: [8] }],
      },
    });
  });

  it("rejects malformed policy values before sending a request", async () => {
    const fetchMock = mockFetch(snapshotWire);

    await expect(
      patchRowFilterPolicySafe(ctx, {
        ...target,
        expectedRevision: null,
        policy: {
          relation: "and",
          conditions: [{ propertyName: "priority", operator: "between", values: [8, 3] }],
        },
        reason: "Invalid range",
      }),
    ).rejects.toThrow(/lower value/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
