import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDepartment,
  createUser,
  deleteDepartment,
  deleteUser,
  getDepartment,
  getDepartmentMembers,
  getUser,
  getUserRoles,
  listDepartments,
  listRoles,
  listUsers,
  setUserPassword,
} from "../../src/api/admin.js";
import type { RequestContext } from "../../src/types.js";

const ctx: RequestContext = {
  baseUrl: "https://demo.example.com",
  token: "t",
  businessDomain: "bd_public",
  insecure: false,
};

// A token whose JWT payload carries `sub` so callerUserId resolves without a fetch.
const jwtToken = `h.${Buffer.from(JSON.stringify({ sub: "caller-1" })).toString("base64url")}.s`;
const ctxJwt: RequestContext = { ...ctx, token: jwtToken };

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
function body(f: typeof fetch): unknown {
  const a = (f as unknown as { mock: { calls: CallArgs[] } }).mock.calls[0];
  if (!a) throw new Error("fetch not called");
  return JSON.parse(a[1].body as string);
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

describe("admin writes", () => {
  it("org create → thrift Usrm_AddDepartment with ncTAddDepartParam", async () => {
    const f = mockFetch();
    await createDepartment(ctx, { name: "Eng", parentId: "-1" });
    expect(url(f).pathname).toBe("/isfweb/api/ShareMgnt/Usrm_AddDepartment");
    const b = body(f) as Array<{ ncTAddDepartParam: { departName: string } }>;
    expect(b[0]?.ncTAddDepartParam.departName).toBe("Eng");
  });
  it("org delete → DELETE management/departments/:id", async () => {
    const f = mockFetch();
    await deleteDepartment(ctx, "d1");
    const a = (f as unknown as { mock: { calls: CallArgs[] } }).mock.calls[0];
    expect(new URL(a?.[0] ?? "").pathname).toBe(
      "/api/user-management/v1/management/departments/d1",
    );
    expect(a?.[1].method).toBe("DELETE");
  });
  it("user create → thrift Usrm_AddUser with caller uuid from JWT sub", async () => {
    const f = mockFetch();
    await createUser(ctxJwt, { loginName: "alice", email: "a@x.io" });
    expect(url(f).pathname).toBe("/isfweb/api/ShareMgnt/Usrm_AddUser");
    const b = body(f) as [
      { ncTUsrmAddUserInfo: { user: { ncTUsrmUserInfo: { loginName: string } } } },
      string,
    ];
    expect(b[0].ncTUsrmAddUserInfo.user.ncTUsrmUserInfo.loginName).toBe("alice");
    expect(b[1]).toBe("caller-1");
  });
  it("user delete → DELETE users/:id", async () => {
    const f = mockFetch();
    await deleteUser(ctx, "u1");
    const a = (f as unknown as { mock: { calls: CallArgs[] } }).mock.calls[0];
    expect(new URL(a?.[0] ?? "").pathname).toBe("/api/user-management/v1/users/u1");
    expect(a?.[1].method).toBe("DELETE");
  });
  it("reset-password → PUT .../password with an RSA-encrypted (base64) blob", async () => {
    const f = mockFetch();
    await setUserPassword(ctx, "u1", "Secret123!");
    const a = (f as unknown as { mock: { calls: CallArgs[] } }).mock.calls[0];
    expect(new URL(a?.[0] ?? "").pathname).toBe(
      "/api/user-management/v1/management/users/u1/password",
    );
    expect(a?.[1].method).toBe("PUT");
    const b = body(f) as { password: string };
    // 1024-bit RSA → 128 bytes → 172-char base64; never the plaintext.
    expect(b.password).not.toBe("Secret123!");
    expect(b.password.length).toBe(172);
  });
});
