import { afterEach, describe, expect, it, vi } from "vitest";
import { listDepartments, listRoles, listUsers } from "../../src/api/admin.js";
import type { RequestContext } from "../../src/types.js";

const ctx: RequestContext = {
  baseUrl: "https://demo.example.com",
  token: "t",
  businessDomain: "bd_public",
  insecure: false,
};

type CallArgs = [string, RequestInit];
function mockFetch(): typeof fetch {
  const fn = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fn);
  return fn as unknown as typeof fetch;
}
function url(f: typeof fetch): URL {
  const a = (f as unknown as { mock: { calls: CallArgs[] } }).mock.calls[0];
  if (!a) throw new Error("fetch not called");
  return new URL(a[0]);
}
afterEach(() => vi.unstubAllGlobals());

describe("admin operator reads", () => {
  it("org list → console/search-departments with role", async () => {
    const f = mockFetch();
    await listDepartments(ctx, { name: "eng" });
    const u = url(f);
    expect(u.pathname).toContain("/api/user-management/v1/console/search-departments/");
    expect(u.searchParams.get("role")).toBe("super_admin");
    expect(u.searchParams.get("name")).toBe("eng");
  });
  it("user list → console/search-users", async () => {
    const f = mockFetch();
    await listUsers(ctx, { orgId: "d1" });
    const u = url(f);
    expect(u.pathname).toContain("/api/user-management/v1/console/search-users/");
    expect(u.searchParams.get("department_id")).toBe("d1");
  });
  it("role list → authorization/v1/roles", async () => {
    const f = mockFetch();
    await listRoles(ctx, { keyword: "admin" });
    const u = url(f);
    expect(u.pathname).toBe("/api/authorization/v1/roles");
    expect(u.searchParams.get("keyword")).toBe("admin");
  });
});
