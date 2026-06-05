/**
 * OAuth2 login flows for `openbkn auth login` — browser (PKCE + loopback
 * callback) and headless password sign-in (RSA-encrypted password → `/oauth2/signin`).
 * Ports the kweaver-admin flow: dynamic client registration (Hydra), authorize
 * redirect, code exchange. Returns a token triple; the command persists it.
 */
import { spawn } from "node:child_process";
import { createHash, constants as cryptoConstants, publicEncrypt, randomBytes } from "node:crypto";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { InputError } from "../utils/errors.js";

export const DEFAULT_REDIRECT_PORT = 9010;
export const DEFAULT_SCOPE = "openid offline all";

// Studioweb fixed RSA public key for `/oauth2/signin` password encryption
// (kweaver deploy/auto_config LOGIN_PUBLIC_KEY).
const STUDIOWEB_LOGIN_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAsyOstgbYuubBi2PUqeVj
GKlkwVUY6w1Y8d4k116dI2SkZI8fxcjHALv77kItO4jYLVplk9gO4HAtsisnNE2o
wlYIqdmyEPMwupaeFFFcg751oiTXJiYbtX7ABzU5KQYPjRSEjMq6i5qu/mL67XTk
hvKwrC83zme66qaKApmKupDODPb0RRkutK/zHfd1zL7sciBQ6psnNadh8pE24w8O
2XVy1v2bgSNkGHABgncR7seyIg81JQ3c/Axxd6GsTztjLnlvGAlmT1TphE84mi99
fUaGD2A1u1qdIuNc+XuisFeNcUW6fct0+x97eS2eEGRr/7qxWmO/P20sFVzXc2bF
1QIDAQAB
-----END PUBLIC KEY-----`;

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

function parseSigninProps(html: string): {
  csrftoken: string;
  challenge?: string;
  remember?: boolean;
} {
  const m = html.match(/<script[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m?.[1]) throw new Error("Could not find __NEXT_DATA__ on /oauth2/signin.");
  const data = JSON.parse(m[1]) as Record<string, unknown>;
  const pp = (data.props as Record<string, unknown> | undefined)?.pageProps as
    | Record<string, unknown>
    | undefined;
  const csrftoken = (pp?.csrftoken ?? pp?._csrf) as string | undefined;
  if (typeof csrftoken !== "string") throw new Error("Sign-in page did not expose csrftoken.");
  return {
    csrftoken,
    challenge: typeof pp?.challenge === "string" ? pp.challenge : undefined,
    remember: pp?.remember === true || pp?.remember === "true",
  };
}

async function followToCallback(
  startUrl: string,
  jar0: string,
  state: string,
  redirectUri: string,
): Promise<string> {
  let url = startUrl;
  let jar = jar0;
  const cb = new URL(redirectUri);
  for (let hop = 0; hop < 40; hop++) {
    const resp = await fetch(url, {
      headers: { Cookie: jar, Accept: "text/html,*/*;q=0.8" },
      redirect: "manual",
    });
    jar = mergeCookies(jar, resp);
    if (![302, 303, 307, 308].includes(resp.status)) {
      throw new Error(`Unexpected OAuth response (HTTP ${resp.status}).`);
    }
    const loc = resp.headers.get("location");
    if (!loc) throw new Error(`OAuth redirect missing Location (HTTP ${resp.status}).`);
    const next = new URL(loc, url);
    if (next.origin === cb.origin && next.pathname === cb.pathname) {
      const err = next.searchParams.get("error");
      if (err) throw new Error(`Authorization failed: ${err}`);
      const code = next.searchParams.get("code");
      if (next.searchParams.get("state") !== state) throw new Error("OAuth state mismatch.");
      if (!code) throw new Error("Callback missing authorization code.");
      return code;
    }
    url = next.href;
  }
  throw new Error("Too many OAuth redirects.");
}

export interface PasswordLoginOptions {
  clientId?: string;
  port?: number;
  scope?: string;
  signinPublicKeyPem?: string;
}

/** Headless password login via RSA-encrypted `/oauth2/signin`. */
export async function passwordLogin(
  baseUrl: string,
  username: string,
  password: string,
  opts: PasswordLoginOptions = {},
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

  let jar = "";
  const authResp = await fetch(
    buildAuthorizeUrl(base, client.clientId, redirectUri, state, challenge, scope),
    { redirect: "manual" },
  );
  jar = mergeCookies(jar, authResp);
  const authLoc = authResp.headers.get("location");
  if (!authLoc) throw new Error(`/oauth2/auth did not redirect (HTTP ${authResp.status}).`);
  const signinUrl = new URL(authLoc, base);
  if (!signinUrl.pathname.includes("signin")) {
    throw new Error(`Expected a sign-in redirect, got: ${authLoc}`);
  }

  const pageResp = await fetch(signinUrl.href, {
    headers: { Cookie: jar, Accept: "text/html,*/*;q=0.8" },
    redirect: "manual",
  });
  jar = mergeCookies(jar, pageResp);
  const props = parseSigninProps(await pageResp.text());
  const loginChallenge =
    signinUrl.searchParams.get("login_challenge")?.trim() || props.challenge?.trim();
  if (!loginChallenge) throw new Error("Could not resolve the login challenge.");

  const cipher = publicEncrypt(
    {
      key: opts.signinPublicKeyPem ?? STUDIOWEB_LOGIN_PUBLIC_KEY_PEM,
      padding: cryptoConstants.RSA_PKCS1_PADDING,
    },
    Buffer.from(password, "utf8"),
  ).toString("base64");

  const postResp = await fetch(`${base}/oauth2/signin`, {
    method: "POST",
    headers: {
      Cookie: jar,
      "Content-Type": "application/json",
      Accept: "application/json, text/plain, */*",
      Origin: new URL(base).origin,
      Referer: signinUrl.href,
    },
    body: JSON.stringify({
      _csrf: props.csrftoken,
      challenge: loginChallenge,
      account: username,
      password: cipher,
      vcode: { id: "", content: "" },
      dualfactorauthinfo: { validcode: { vcode: "" }, OTP: { OTP: "" } },
      remember: props.remember ?? false,
      device: { name: "", description: "", client_type: "console_web", udids: [] },
    }),
    redirect: "manual",
  });
  jar = mergeCookies(jar, postResp);

  let code: string;
  if ([302, 303, 307].includes(postResp.status)) {
    const loc = postResp.headers.get("location");
    if (!loc) throw new Error("Sign-in response missing Location.");
    code = await followToCallback(new URL(loc, base).href, jar, state, redirectUri);
  } else if (postResp.status === 200) {
    const text = await postResp.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      /* not JSON */
    }
    const redir = json && typeof json.redirect === "string" ? json.redirect : "";
    if (!redir) {
      const msg = json && typeof json.message === "string" ? json.message : text.slice(0, 300);
      throw new InputError(`Sign-in failed: ${msg}`);
    }
    code = await followToCallback(new URL(redir, base).href, jar, state, redirectUri);
  } else {
    throw new InputError(
      `Sign-in failed (HTTP ${postResp.status}): ${(await postResp.text()).slice(0, 300)}`,
    );
  }
  return exchangeCode(base, code, redirectUri, client, verifier);
}

// ── device-code login (RFC 8628) ──────────────────────────────────────────────

const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
/** Seeded public client; device flow needs no secret and no `all` scope. */
const DEFAULT_DEVICE_CLIENT_ID = "openbkn";
const DEVICE_SCOPE = "openid offline";

export interface DevicePrompt {
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
}

export interface DeviceLoginOptions {
  clientId?: string;
  scope?: string;
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
  const authRes = await fetch(`${base}/oauth2/device/auth`, form({ client_id: clientId, scope }));
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
