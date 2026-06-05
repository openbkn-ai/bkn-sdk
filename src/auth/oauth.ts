/**
 * OAuth2 login flows for `openbkn auth login` against bkn-safe + hydra:
 *  - password: headless authorization_code + PKCE, driving bkn-safe /login +
 *    /consent server-to-server (no browser).
 *  - device:   RFC 8628 device-code (seeded public client `openbkn-sdk`).
 *  - browser:  PKCE + loopback callback.
 * All use pre-seeded fixed clients (no dynamic registration). Returns a token
 * triple; the command persists it.
 */
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { InputError } from "../utils/errors.js";

export const DEFAULT_REDIRECT_PORT = 9010;
export const DEFAULT_SCOPE = "openid offline all";
/** Seeded bkn-safe public client for headless password login (authorization_code + PKCE). */
const DEFAULT_PASSWORD_CLIENT_ID = "openbkn-cli";

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
}

export function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

function buildAuthorizeUrl(
  base: string,
  clientId: string,
  redirectUri: string,
  state: string,
  codeChallenge: string,
  scope = DEFAULT_SCOPE,
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
    state,
    "x-forwarded-prefix": "",
    lang: "zh-cn",
    product: "adp",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${base}/oauth2/auth?${params.toString()}`;
}

function mapToken(data: {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
}): OAuthTokens {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    idToken: data.id_token,
  };
}

export interface RegisteredClient {
  clientId: string;
  clientSecret?: string;
}

/** Register an OAuth2 client with Hydra. Returns its id (+ secret if confidential). */
export async function registerClient(
  base: string,
  redirectUri: string,
  scope = DEFAULT_SCOPE,
): Promise<RegisteredClient> {
  const res = await fetch(`${base}/oauth2/clients`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_name: "openbkn-cli",
      grant_types: ["authorization_code", "implicit", "refresh_token"],
      response_types: ["token id_token", "code", "token"],
      scope,
      redirect_uris: [redirectUri],
      post_logout_redirect_uris: [redirectUri.replace("/callback", "/successful-logout")],
      metadata: { device: { name: "openbkn-cli", client_type: "web", description: "openbkn CLI" } },
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Client registration failed (${res.status}): ${(await res.text()) || res.statusText}`,
    );
  }
  const data = (await res.json()) as { client_id: string; client_secret?: string };
  return { clientId: data.client_id, clientSecret: data.client_secret };
}

async function exchangeCode(
  base: string,
  code: string,
  redirectUri: string,
  client: RegisteredClient,
  codeVerifier: string,
): Promise<OAuthTokens> {
  const params: Record<string, string> = {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  };
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  if (client.clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${client.clientId}:${client.clientSecret}`).toString("base64")}`;
  } else {
    params.client_id = client.clientId;
  }
  const res = await fetch(`${base}/oauth2/token`, {
    method: "POST",
    headers,
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) {
    throw new Error(
      `Token exchange failed (${res.status}): ${(await res.text()) || res.statusText}`,
    );
  }
  return mapToken((await res.json()) as { access_token: string });
}

function startCallbackServer(
  port: number,
): Promise<{ code: string; state?: string; close: () => void }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const u = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      if (u.pathname !== "/callback") {
        res.writeHead(404);
        res.end();
        return;
      }
      const code = u.searchParams.get("code");
      const error = u.searchParams.get("error");
      if (error) {
        res.writeHead(400, { "content-type": "text/html" });
        res.end(`<h1>Login failed</h1><p>${error}</p>`);
        server.close(() => reject(new Error(`OAuth error: ${error}`)));
        return;
      }
      if (!code) {
        res.writeHead(400);
        res.end("missing code");
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<h1>Login successful</h1><p>You can close this window.</p>");
      resolve({
        code,
        state: u.searchParams.get("state") ?? undefined,
        close: () => server.close(),
      });
    });
    server.on("error", reject);
    server.listen(port, "127.0.0.1");
  });
}

export function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(cmd, [url], {
      stdio: "ignore",
      detached: true,
      shell: process.platform === "win32",
    }).unref();
  } catch {
    /* fall through — URL is printed by the caller */
  }
}

export interface BrowserLoginOptions {
  clientId?: string;
  port?: number;
  noBrowser?: boolean;
  scope?: string;
}

/** Browser PKCE login: resolve client → open authorize URL → catch callback → exchange. */
export async function browserLogin(
  baseUrl: string,
  opts: BrowserLoginOptions = {},
): Promise<OAuthTokens> {
  const base = normalizeBaseUrl(baseUrl);
  const port = opts.port ?? DEFAULT_REDIRECT_PORT;
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const scope = opts.scope ?? DEFAULT_SCOPE;
  const client = opts.clientId
    ? { clientId: opts.clientId }
    : await registerClient(base, redirectUri, scope);
  const { verifier, challenge } = generatePkce();
  const state = randomBytes(12).toString("hex");
  const authUrl = buildAuthorizeUrl(base, client.clientId, redirectUri, state, challenge, scope);

  const waiter = startCallbackServer(port);
  if (opts.noBrowser) {
    process.stderr.write(`Open this URL to log in:\n${authUrl}\n`);
  } else {
    process.stderr.write(`Opening browser for login…\nIf it doesn't open, visit:\n${authUrl}\n`);
    openBrowser(authUrl);
  }
  const { code, state: returned, close } = await waiter;
  close();
  if (returned && returned !== state) throw new Error("OAuth state mismatch — possible CSRF.");
  return exchangeCode(base, code, redirectUri, client, verifier);
}

// ── headless password sign-in ─────────────────────────────────────────────────

function mergeCookies(existing: string, res: Response): string {
  const setCookies =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : res.headers.get("set-cookie")
        ? [res.headers.get("set-cookie") as string]
        : [];
  const map = new Map<string, string>();
  const add = (pair: string) => {
    const eq = pair.indexOf("=");
    if (eq > 0) map.set(pair.slice(0, eq), pair.slice(eq + 1));
  };
  for (const p of existing
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean))
    add(p);
  for (const sc of setCookies) add(sc.split(";")[0]?.trim() ?? "");
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

export interface PasswordLoginOptions {
  clientId?: string;
  port?: number;
  scope?: string;
}

/**
 * Headless password login against bkn-safe. Drives hydra's authorization_code +
 * PKCE flow server-to-server (no browser, no callback server): authorize →
 * POST /login (plaintext account/password over TLS) → POST /consent (allow) →
 * capture the code off the loopback redirect → exchange for tokens. The redirect
 * chain is followed manually, POSTing credentials/consent at the bkn-safe pages
 * and GET-following hydra's verifier hops in between.
 */
export async function passwordLogin(
  baseUrl: string,
  username: string,
  password: string,
  opts: PasswordLoginOptions = {},
): Promise<OAuthTokens> {
  const base = normalizeBaseUrl(baseUrl);
  const port = opts.port ?? DEFAULT_REDIRECT_PORT;
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  // bkn-safe clients are scoped `openid offline` (no `all` — would be invalid_scope).
  const scope = opts.scope ?? "openid offline";
  const client = { clientId: opts.clientId ?? DEFAULT_PASSWORD_CLIENT_ID };
  const { verifier, challenge } = generatePkce();
  const state = randomBytes(12).toString("hex");
  const cb = new URL(redirectUri);

  let jar = "";
  const post = async (path: string, body: Record<string, string>) => {
    const r = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        Cookie: jar,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "text/html,*/*;q=0.8",
      },
      body: new URLSearchParams(body).toString(),
      redirect: "manual",
    });
    jar = mergeCookies(jar, r);
    return r;
  };

  // 1) kick off authorize → hydra 302s to bkn-safe /login?login_challenge=…
  const authResp = await fetch(
    buildAuthorizeUrl(base, client.clientId, redirectUri, state, challenge, scope),
    { redirect: "manual" },
  );
  jar = mergeCookies(jar, authResp);
  let loc = authResp.headers.get("location");
  if (!loc) {
    throw new Error(
      `/oauth2/auth did not redirect (HTTP ${authResp.status}): ${(await authResp.text()).slice(0, 200)}`,
    );
  }

  // 2) walk the redirect chain: POST creds at /login, approve at /consent, GET
  //    hydra's verifier hops, stop when we land on the loopback callback.
  let code = "";
  for (let hop = 0; hop < 20; hop++) {
    const u = new URL(loc, base);
    if (u.origin === cb.origin && u.pathname === cb.pathname) {
      if (u.searchParams.get("state") !== state) throw new Error("OAuth state mismatch.");
      const c = u.searchParams.get("code");
      if (!c) throw new InputError(`Callback missing authorization code: ${loc}`);
      code = c;
      break;
    }
    let r: Response;
    if (u.pathname.endsWith("/login")) {
      const lc = u.searchParams.get("login_challenge");
      if (!lc) throw new Error(`/login without login_challenge: ${loc}`);
      r = await post("/login", { login_challenge: lc, account: username, password });
      if (r.status === 401) throw new InputError("登录失败：账号或密码错误");
    } else if (u.pathname.endsWith("/consent")) {
      const cc = u.searchParams.get("consent_challenge");
      if (!cc) throw new Error(`/consent without consent_challenge: ${loc}`);
      r = await post("/consent", { consent_challenge: cc, decision: "allow" });
    } else {
      r = await fetch(u.href, {
        headers: { Cookie: jar, Accept: "text/html,*/*;q=0.8" },
        redirect: "manual",
      });
      jar = mergeCookies(jar, r);
    }
    const next = r.headers.get("location");
    if (!next) {
      throw new InputError(
        `OAuth flow stalled at ${u.pathname} (HTTP ${r.status}): ${(await r.text()).slice(0, 200)}`,
      );
    }
    loc = next;
  }
  if (!code) throw new Error("Too many OAuth redirects without reaching the callback.");
  return exchangeCode(base, code, redirectUri, client, verifier);
}

// ── device-code login (RFC 8628) ──────────────────────────────────────────────

const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
/** Seeded bkn-safe public client (device_code + refresh, auth none, scope openid offline). */
const DEFAULT_DEVICE_CLIENT_ID = "openbkn-sdk";
const DEVICE_SCOPE = "openid offline";

export interface DevicePrompt {
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
}

export interface DeviceLoginOptions {
  clientId?: string;
  scope?: string;
  /** Requested token audience (the seeded client is scoped to `bkn-safe`). */
  audience?: string;
  onPrompt?: (info: DevicePrompt) => void;
}

interface DeviceAuthResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval?: number;
}

const form = (body: Record<string, string>) =>
  ({
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(body).toString(),
  }) satisfies RequestInit;

/** Device-code login: request code → user authorizes in browser → poll token. */
export async function deviceLogin(
  baseUrl: string,
  opts: DeviceLoginOptions = {},
): Promise<OAuthTokens> {
  const base = normalizeBaseUrl(baseUrl);
  const clientId = opts.clientId ?? DEFAULT_DEVICE_CLIENT_ID;
  const scope = opts.scope ?? DEVICE_SCOPE;

  // 1) device authorization request
  const authParams: Record<string, string> = { client_id: clientId, scope };
  if (opts.audience) authParams.audience = opts.audience;
  const authRes = await fetch(`${base}/oauth2/device/auth`, form(authParams));
  if (!authRes.ok) {
    throw new Error(
      `Device auth failed (${authRes.status}): ${(await authRes.text()) || authRes.statusText}`,
    );
  }
  const da = (await authRes.json()) as DeviceAuthResponse;
  if (!da.verification_uri) {
    throw new Error(
      "Device auth returned no verification_uri — is Hydra's device flow configured?",
    );
  }

  // 2) surface user_code + URL to the caller (prints / opens browser)
  opts.onPrompt?.({
    userCode: da.user_code,
    verificationUri: da.verification_uri,
    verificationUriComplete: da.verification_uri_complete,
  });

  // 3) poll the token endpoint until authorized / expired
  let interval = (da.interval ?? 5) * 1000;
  const deadline = Date.now() + da.expires_in * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    const tokRes = await fetch(
      `${base}/oauth2/token`,
      form({ grant_type: DEVICE_GRANT, device_code: da.device_code, client_id: clientId }),
    );
    const data = (await tokRes.json().catch(() => ({}))) as Record<string, unknown>;
    if (tokRes.ok) return mapToken(data as { access_token: string });

    switch (data.error) {
      case "authorization_pending":
        break; // keep polling
      case "slow_down":
        interval += 5000; // back off per RFC 8628 §3.5
        break;
      case "access_denied":
        throw new InputError("Device authorization denied.");
      case "expired_token":
        throw new InputError("Device code expired — run login again.");
      default:
        throw new Error(`Device token poll failed: ${String(data.error ?? tokRes.status)}`);
    }
  }
  throw new InputError("Device login timed out.");
}
