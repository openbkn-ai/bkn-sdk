import { afterEach, describe, expect, it, vi } from "vitest";

const { credentialDeviceLogin } = vi.hoisted(() => ({ credentialDeviceLogin: vi.fn() }));

vi.mock("../../src/auth/oauth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/auth/oauth.js")>();
  return { ...actual, credentialDeviceLogin };
});

import { authFetch } from "../../src/api/auth-fetch.js";
import { createAuthenticatedClient } from "../../src/client.js";

afterEach(() => {
  credentialDeviceLogin.mockReset();
  vi.unstubAllGlobals();
});

describe("createAuthenticatedClient", () => {
  it("establishes an in-memory, refreshable account session", async () => {
    credentialDeviceLogin.mockResolvedValue({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
    const onTokenRefresh = vi.fn();

    const client = await createAuthenticatedClient({
      baseUrl: "https://platform.example.com/",
      auth: { username: "alice", password: "secret" },
      onTokenRefresh,
    });

    expect(credentialDeviceLogin).toHaveBeenCalledWith(
      "https://platform.example.com/",
      "alice",
      "secret",
      {
        insecure: undefined,
      },
    );
    expect(client.ctx).toMatchObject({
      baseUrl: "https://platform.example.com",
      token: "access-token",
      refresh: {
        refreshToken: "refresh-token",
        expiresAt: "2030-01-01T00:00:00.000Z",
      },
    });

    client.ctx.refresh?.persist({ accessToken: "next-access", refreshToken: "next-refresh" });
    expect(onTokenRefresh).toHaveBeenCalledWith({
      accessToken: "next-access",
      refreshToken: "next-refresh",
    });
  });

  it("rejects empty credentials before starting an OAuth flow", async () => {
    await expect(
      createAuthenticatedClient({
        baseUrl: "https://platform.example.com",
        auth: { username: "", password: "" },
      }),
    ).rejects.toThrow("Account authentication requires a non-empty username and password.");
    expect(credentialDeviceLogin).not.toHaveBeenCalled();
  });

  it("refreshes the account session and notifies the service after a 401", async () => {
    credentialDeviceLogin.mockResolvedValue({ accessToken: "old-access", refreshToken: "refresh" });
    const onTokenRefresh = vi.fn();
    const fetch = vi.fn(async () =>
      Response.json({ access_token: "new-access", refresh_token: "new-refresh" }),
    );
    vi.stubGlobal("fetch", fetch);
    const client = await createAuthenticatedClient({
      baseUrl: "https://platform.example.com",
      auth: { username: "alice", password: "secret" },
      onTokenRefresh,
    });
    let attempts = 0;

    const response = await authFetch(client.ctx, async () => {
      attempts += 1;
      return new Response("", { status: attempts === 1 ? 401 : 200 });
    });

    expect(response.status).toBe(200);
    expect(client.ctx.token).toBe("new-access");
    expect(onTokenRefresh).toHaveBeenCalledWith({
      accessToken: "new-access",
      refreshToken: "new-refresh",
    });
  });
});
