import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getDepartment,
  getDepartmentMembers,
  getUser,
  getUserRoles,
  listDepartments,
  listRoles,
  listUsers,
} from "../../src/api/admin.js";
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
  it("user get → ISFWeb thrift Usrm_GetUserInfo with [id] body", async () => {
    const f = mockFetch();
    await getUser(ctx, "u1");
    const a = (f as unknown as { mock: { calls: CallArgs[] } }).mock.calls[0];
    if (!a) throw new Error("fetch not called");
    expect(new URL(a[0]).pathname).toBe("/isfweb/api/ShareMgnt/Usrm_GetUserInfo");
    expect(a[1].method).toBe("POST");
    expect(JSON.parse(a[1].body as string)).toEqual(["u1"]);
  });
  it("org get → thrift Usrm_GetOrgDepartmentById", async () => {
    const f = mockFetch();
    await getDepartment(ctx, "d1");
    const u = url(f);
    expect(u.pathname).toBe("/isfweb/api/ShareMgnt/Usrm_GetOrgDepartmentById");
  });
  it("org members → department-members public route, fields=users", async () => {
    const f = mockFetch();
    await getDepartmentMembers(ctx, "d1", { limit: 5 });
    const u = url(f);
    expect(u.pathname).toBe("/api/user-management/v1/department-members/d1/users");
    expect(u.searchParams.get("limit")).toBe("5");
  });
  it("user roles → authorization accessor_roles", async () => {
    const f = mockFetch();
    await getUserRoles(ctx, "u1");
    const u = url(f);
    expect(u.pathname).toBe("/api/authorization/v1/accessor_roles");
    expect(u.searchParams.get("accessor_id")).toBe("u1");
    expect(u.searchParams.get("accessor_type")).toBe("user");
  });
});
