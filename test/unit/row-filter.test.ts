import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  applyRowFilterPolicySafe,
  explainRowFilterPolicySafe,
  getRowFilterPolicySafe,
  patchRowFilterPolicySafe,
} from "../../src/api/safe.js";
import type { RowFilterPolicy } from "../../src/api/safe.js";
import { admin } from "../../src/resources/admin.js";
import type { RequestContext } from "../../src/types.js";
import { HttpError } from "../../src/utils/errors.js";
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
  it("accepts 128-character resource ID segments and rejects 129 characters", async () => {
    const longRef = `${"k".repeat(128)}/${"o".repeat(128)}`;
    const fetchMock = mockFetch({ ...snapshotWire, object_type_ref: longRef });

    await expect(
      getRowFilterPolicySafe(ctx, { ...target, objectTypeRef: longRef }),
    ).resolves.toEqual(expect.objectContaining({ objectTypeRef: longRef }));
    expect(fetchMock).toHaveBeenCalledOnce();

    await expect(
      getRowFilterPolicySafe(ctx, { ...target, objectTypeRef: `${"k".repeat(129)}/order` }),
    ).rejects.toThrow(/canonical/);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

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

  it.each([null, 0, false])(
    "rejects a non-object apply policy %j before requesting",
    async (policy) => {
      const fetchMock = mockFetch(snapshotWire);

      await expect(
        applyRowFilterPolicySafe(ctx, {
          ...target,
          expectedRevision: null,
          policy: policy as unknown as RowFilterPolicy,
          reason: "Apply a restriction",
        }),
      ).rejects.toThrow(/non-null JSON object/);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("maps effective predicates and role policy sources from explain", async () => {
    mockFetch({
      snapshot: snapshotWire,
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

    const explanation = await admin(ctx).rowFilterExplain(target);

    expect(explanation.rolePolicyOnly).toBe(false);
    expect(explanation.snapshot).toMatchObject({
      objectTypeRef: target.objectTypeRef,
      subject: target.subject,
      revision: snapshotWire.revision,
      availableFields: [{ displayName: "Sales region", name: "region", type: "string" }],
    });
    expect(explanation.directPolicy).toEqual(explanation.snapshot.policy);
    expect(explanation.effectiveRowFilterDigest).toBe("sha256:digest");
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

  it("accepts a minimal user explanation and legacy explicit false", async () => {
    for (const flag of [{}, { role_policy_only: false }]) {
      mockFetch({ snapshot: snapshotWire, ...flag });
      const result = await explainRowFilterPolicySafe(ctx, target);
      expect(result).toEqual({
        snapshot: expect.objectContaining({ subject: target.subject }),
        rolePolicyOnly: false,
      });
    }
  });

  it("accepts a role-only explanation without user-effective fields", async () => {
    const subject = { type: "role" as const, id: "sales-east" };
    mockFetch({ snapshot: { ...snapshotWire, subject }, role_policy_only: true });
    await expect(explainRowFilterPolicySafe(ctx, { ...target, subject })).resolves.toEqual({
      snapshot: expect.objectContaining({ subject }),
      rolePolicyOnly: true,
    });
  });

  it.each([
    { type: "role" as const, flag: undefined },
    { type: "role" as const, flag: false },
    { type: "user" as const, flag: true },
    ...(["user", "role"] as const).flatMap((type) =>
      [null, "false", "true", 0, 1, {}, []].map((flag) => ({ type, flag })),
    ),
  ])("rejects an invalid $type explanation flag $flag", async ({ type, flag }) => {
    const subject = { type, id: "subject-1" };
    mockFetch({ snapshot: { ...snapshotWire, subject }, role_policy_only: flag });
    const error = await explainRowFilterPolicySafe(ctx, { ...target, subject }).catch(
      (error: unknown) => error,
    );
    expect(error).toBeInstanceOf(z.ZodError);
    expect((error as z.ZodError).issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: ["role_policy_only"] })]),
    );
  });

  it.each([401, 403, 409])("preserves explain HTTP %i errors", async (status) => {
    const body = { error: { code: "test_error", message: "Request denied" } };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
    vi.stubGlobal("fetch", fetchMock);
    const error = await admin(ctx)
      .rowFilterExplain(target)
      .catch((error: unknown) => error);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ status });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("explains the same subject and revision after a rejected stale update", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(snapshotWire)))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: "revision_conflict" } }), { status: 409 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ snapshot: snapshotWire })));
    vi.stubGlobal("fetch", fetchMock);
    const resource = admin(ctx);
    const before = await resource.rowFilterGet(target);
    await expect(
      resource.rowFilterApply({
        ...target,
        expectedRevision: "stale-revision",
        policy: {
          relation: "and",
          conditions: [{ propertyName: "region", operator: "in", values: ["west"] }],
        },
        reason: "Check stale revision rejection",
      }),
    ).rejects.toMatchObject({ status: 409 });
    const current = await resource.rowFilterExplain(target);
    expect(current.snapshot.revision).toBe(before.revision);
    expect(current.snapshot.subject).toEqual(target.subject);
    expect(current.snapshot.policy).toEqual(before.policy);
    expect(current.rolePolicyOnly).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
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

  it("rejects wire-shaped conditions before omitting an undefined property name", async () => {
    const fetchMock = mockFetch(snapshotWire);
    const wireShapedPolicy = {
      relation: "and",
      conditions: [{ property_name: "region", operator: "in", values: ["east"] }],
    } as unknown as RowFilterPolicy;

    await expect(
      patchRowFilterPolicySafe(ctx, {
        ...target,
        expectedRevision: null,
        policy: wireShapedPolicy,
        reason: "Reject malformed SDK input",
      }),
    ).rejects.toThrow(/property name/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
