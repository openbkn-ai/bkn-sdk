import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assignRoleSafe,
  createDepartmentSafe,
  createRoleSafe,
  createUserSafe,
  deleteUserSafe,
  findUserByAccountSafe,
  getDepartmentMembersSafe,
  getUserRolesSafe,
  getUserSafe,
  listDepartmentsSafe,
  listRolesSafe,
  listUsersSafe,
  notOnSafe,
  removeRoleSafe,
  setRolePermissionSafe,
  setUserPasswordSafe,
  updateUserSafe,
} from "../../src/api/safe.js";
import type { RequestContext } from "../../src/types.js";

const ctx: RequestContext = {
  baseUrl: "https://demo.example.com",
  token: "t",
  businessDomain: "bd_public",
  insecure: false,
};

type Call = [string, RequestInit];
function mockFetch(body: unknown = {}): typeof fetch {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal("fetch", fn);
  return fn as unknown as typeof fetch;
}
function call(f: typeof fetch): Call {
  const a = (f as unknown as { mock: { calls: Call[] } }).mock.calls[0];
  if (!a) throw new Error("fetch not called");
  return a;
}
const bodyOf = (c: Call) => JSON.parse(String(c[1].body));
afterEach(() => vi.unstubAllGlobals());

describe("safe admin api → /api/safe/v1/admin", () => {
  it("listUsers: GET /admin/users with search/offset/limit", async () => {
    const f = mockFetch({ users: [], total: 0 });
    await listUsersSafe(ctx, { search: "ann", offset: 10, limit: 50 });
    const u = new URL(call(f)[0]);
    expect(u.pathname).toBe("/api/safe/v1/admin/users");
    expect(u.searchParams.get("search")).toBe("ann");
    expect(u.searchParams.get("limit")).toBe("50");
  });

  it("findUserByAccount: GET /admin/users?account=", async () => {
    const f = mockFetch({ users: [], total: 0 });
    await findUserByAccountSafe(ctx, "admin");
    expect(new URL(call(f)[0]).searchParams.get("account")).toBe("admin");
  });

  it("getUser: GET /admin/users/:id (encoded)", async () => {
    const f = mockFetch();
    await getUserSafe(ctx, "u 1");
    expect(new URL(call(f)[0]).pathname).toBe("/api/safe/v1/admin/users/u%201");
  });

  it("createUser: POST plaintext password + account_type", async () => {
    const f = mockFetch({ id: "x" });
    await createUserSafe(ctx, { account: "bob", password: "pw", accountType: "other" });
    const c = call(f);
    expect(c[1].method).toBe("POST");
    expect(bodyOf(c)).toMatchObject({ account: "bob", password: "pw", account_type: "other" });
  });

  it("updateUser: PUT only provided fields (snake_case)", async () => {
    const f = mockFetch();
    await updateUserSafe(ctx, "u1", { name: "B", enabled: false });
    const c = call(f);
    expect(c[1].method).toBe("PUT");
    expect(bodyOf(c)).toEqual({ name: "B", enabled: false });
  });

  it("deleteUser: DELETE /admin/users/:id", async () => {
    const f = mockFetch();
    await deleteUserSafe(ctx, "u1");
    expect(call(f)[1].method).toBe("DELETE");
    expect(new URL(call(f)[0]).pathname).toBe("/api/safe/v1/admin/users/u1");
  });

  it("setUserPassword: PUT /password with plaintext", async () => {
    const f = mockFetch();
    await setUserPasswordSafe(ctx, "u1", "newpw");
    const c = call(f);
    expect(new URL(c[0]).pathname).toBe("/api/safe/v1/admin/users/u1/password");
    expect(bodyOf(c)).toEqual({ password: "newpw" });
  });

  it("getUserRoles: GET /admin/role-bindings?accessor_id=", async () => {
    const f = mockFetch({ role_ids: [] });
    await getUserRolesSafe(ctx, "u1");
    const u = new URL(call(f)[0]);
    expect(u.pathname).toBe("/api/safe/v1/admin/role-bindings");
    expect(u.searchParams.get("accessor_id")).toBe("u1");
  });

  it("assign/remove role: POST/DELETE /role-bindings", async () => {
    let f = mockFetch();
    await assignRoleSafe(ctx, "u1", "r1");
    expect(call(f)[1].method).toBe("POST");
    expect(bodyOf(call(f))).toEqual({ accessor_id: "u1", role_id: "r1" });
    vi.unstubAllGlobals();
    f = mockFetch();
    await removeRoleSafe(ctx, "u1", "r1");
    expect(call(f)[1].method).toBe("DELETE");
  });

  it("departments list + members + create", async () => {
    let f = mockFetch({ departments: [], total: 0 });
    await listDepartmentsSafe(ctx, { parentId: "" });
    expect(new URL(call(f)[0]).pathname).toBe("/api/safe/v1/admin/departments");
    vi.unstubAllGlobals();
    f = mockFetch({ users: [] });
    await getDepartmentMembersSafe(ctx, "d1");
    expect(new URL(call(f)[0]).pathname).toBe("/api/safe/v1/admin/departments/d1/members");
    vi.unstubAllGlobals();
    f = mockFetch({ id: "d2" });
    await createDepartmentSafe(ctx, { name: "Eng", parentId: "d1" });
    expect(bodyOf(call(f))).toMatchObject({ name: "Eng", parent_id: "d1" });
  });

  it("roles list + create + permission grant", async () => {
    let f = mockFetch({ roles: [] });
    await listRolesSafe(ctx, "custom");
    const u = new URL(call(f)[0]);
    expect(u.pathname).toBe("/api/safe/v1/admin/roles");
    expect(u.searchParams.get("source")).toBe("custom");
    vi.unstubAllGlobals();
    f = mockFetch({ id: "r9" });
    await createRoleSafe(ctx, { name: "ops" });
    expect(bodyOf(call(f))).toEqual({ name: "ops" });
    vi.unstubAllGlobals();
    f = mockFetch();
    await setRolePermissionSafe(ctx, "r9", true, {
      resourceType: "catalog",
      resourceId: "*",
      operations: ["view_detail"],
    });
    const c = call(f);
    expect(new URL(c[0]).pathname).toBe("/api/safe/v1/admin/roles/r9/permissions");
    expect(c[1].method).toBe("POST");
    expect(bodyOf(c)).toEqual({
      resource: { type: "catalog", id: "*" },
      operations: ["view_detail"],
    });
  });

  it("notOnSafe throws an InputError-style message", () => {
    expect(() => notOnSafe("audit list")).toThrow(/not available on bkn-safe/);
  });
});
