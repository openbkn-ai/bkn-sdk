import { afterEach, describe, expect, it, vi } from "vitest";
import { getAuditLog, listAuditLogs } from "../../src/api/observability-logs.js";
import { admin } from "../../src/resources/admin.js";
import type { RequestContext } from "../../src/types.js";
import { verifiedContext } from "../setup/verified-context.js";

const ctx = verifiedContext<RequestContext>({
  baseUrl: "https://demo.example.com",
  token: "t",
  insecure: false,
});

function mockFetch(body: unknown, status = 200) {
  const fn = vi.fn(async (_url: string) => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}
const urlOf = (fn: ReturnType<typeof vi.fn>) => new URL(String(fn.mock.calls[0]?.[0]));
afterEach(() => vi.unstubAllGlobals());

const record = {
  event_id: "e-1",
  log_category: "audit.admin",
  event_name: "user.create",
  outcome: "success",
  actor_id: "u-1",
  facts: { action: "create", target_type: "user", target_id: "t-1", status_code: 201 },
  correlation: { request_id: "req-1" },
  attributes: { custom: 1 },
};

describe("observability audit logs api", () => {
  it("listAuditLogs: GET /logs with both audit categories by default and no filters", async () => {
    const f = mockFetch({ data: [], next_cursor: null });
    await listAuditLogs(ctx);
    const u = urlOf(f);
    expect(u.pathname).toBe("/api/observability/v1/logs");
    expect(u.searchParams.getAll("categories")).toEqual(["audit.admin", "audit.security"]);
    expect([...u.searchParams.keys()]).toEqual(["categories", "categories"]);
  });

  it("listAuditLogs: maps filters to wire names", async () => {
    const f = mockFetch({ data: [] });
    await listAuditLogs(ctx, {
      categories: ["audit.admin"],
      q: "x",
      actorId: "u",
      requestId: "r",
      targetType: "user",
      targetId: "t",
      outcomes: ["failure"],
      from: "2026-09-01T00:00:00Z",
      to: "2026-09-02T00:00:00Z",
      cursor: "c1",
      page: 3,
      limit: 20,
    });
    const u = urlOf(f);
    expect(u.searchParams.getAll("categories")).toEqual(["audit.admin"]);
    expect(u.searchParams.getAll("outcomes")).toEqual(["failure"]);
    expect(u.searchParams.get("time_from")).toBe("2026-09-01T00:00:00Z");
    expect(u.searchParams.get("time_to")).toBe("2026-09-02T00:00:00Z");
    expect(u.searchParams.get("cursor")).toBe("c1");
    expect(u.searchParams.get("page")).toBe("3");
    expect(u.searchParams.get("limit")).toBe("20");
    expect(u.searchParams.get("target_type")).toBe("user");
  });

  it("listAuditLogs: parses the envelope and keeps unknown fields", async () => {
    mockFetch({
      data: [record],
      next_cursor: "n1",
      partial: false,
      count: { value: 1, accuracy: "exact" },
      pagination: { page: 1, page_size: 50 },
      source_status: [{ source_id: "audit-ledger", status: "ok" }],
    });
    const page = await listAuditLogs(ctx);
    expect(page.data[0]?.event_id).toBe("e-1");
    expect(page.data[0]?.facts?.target_id).toBe("t-1");
    expect(page.next_cursor).toBe("n1");
    expect(page.count?.value).toBe(1);
  });

  it("listAuditLogs: rejects out-of-range limit/page/q before sending", async () => {
    const f = mockFetch({ data: [] });
    await expect(listAuditLogs(ctx, { limit: 19 })).rejects.toThrow(/between 20 and 200/);
    await expect(listAuditLogs(ctx, { limit: 201 })).rejects.toThrow(/between 20 and 200/);
    await expect(listAuditLogs(ctx, { page: 0 })).rejects.toThrow(/positive integer/);
    await expect(listAuditLogs(ctx, { q: "x".repeat(513) })).rejects.toThrow(/512/);
    expect(f).not.toHaveBeenCalled();
  });

  it("listAuditLogs: a malformed body is a clear error", async () => {
    mockFetch({ logs: [], total: 0 });
    await expect(listAuditLogs(ctx)).rejects.toThrow(/Unexpected audit log list response/);
  });

  it("listAuditLogs: surfaces server errors (e.g. 403 without audit access)", async () => {
    mockFetch({ error: { code: "observability_access_denied", message: "denied" } }, 403);
    await expect(listAuditLogs(ctx)).rejects.toThrow();
  });

  it("getAuditLog: GET /logs/:id (encoded) and parses the detail envelope", async () => {
    const f = mockFetch({ data: record, field_projection: { redacted_fields: ["client_ip"] } });
    const d = await getAuditLog(ctx, "a/1");
    expect(urlOf(f).pathname).toBe("/api/observability/v1/logs/a%2F1");
    expect(d.data.event_id).toBe("e-1");
  });

  it("getAuditLog: 404 (not disclosed) rejects", async () => {
    mockFetch({ error: { code: "log_not_disclosed" } }, 404);
    await expect(getAuditLog(ctx, "x")).rejects.toThrow();
  });

  it("regression: admin.auditList/auditGet no longer hit /api/safe/v1/admin/audit-logs", async () => {
    const list = mockFetch({ data: [] });
    await admin(ctx).auditList({ limit: 20 });
    const get = mockFetch({ data: record });
    await admin(ctx).auditGet("e-1");
    for (const fn of [list, get]) {
      const u = String(fn.mock.calls[0]?.[0]);
      expect(u).not.toContain("/api/safe/v1/admin/audit-logs");
      expect(u).toContain("/api/observability/v1/logs");
    }
  });
});
