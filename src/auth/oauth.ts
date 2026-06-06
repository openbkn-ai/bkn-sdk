/**
 * OAuth2 login for `openbkn auth login` against bkn-safe + Ory Hydra.
 *
 * bkn-safe seeds a single public CLI client (`openbkn-sdk`, device_code +
 * refresh, `token_endpoint_auth_method=none`), so every user login rides the
 * RFC 8628 device-code grant — there is no dynamic registration and no usable
 * authorization_code/password client:
 *  - deviceLogin: request a code, surface it (browser/print), poll the token.
 *  - credentialDeviceLogin: request a code, then drive bkn-safe's
 *    verify → /device → /login → /consent pages server-to-server with the
 *    supplied credentials (headless, no browser), then poll.
 * Returns a token triple; the command persists it.
 */
import { spawn } from "node:child_process";
import { InputError } from "../utils/errors.js";

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
}

export function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
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

/** Merge an existing `Cookie` header string with a response's Set-Cookie(s). */
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
  /** Cap the poll wait (ms); defaults to the device code's `expires_in`. */
  timeoutMs?: number;
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

/** POST /oauth2/device/auth → the device authorization response. */
async function requestDeviceCode(
  base: string,
  clientId: string,
  scope: string,
  audience?: string,
): Promise<DeviceAuthResponse> {
  const params: Record<string, string> = { client_id: clientId, scope };
  if (audience) params.audience = audience;
  const res = await fetch(`${base}/oauth2/device/auth`, form(params));
  if (!res.ok) {
    throw new Error(`Device auth failed (${res.status}): ${(await res.text()) || res.statusText}`);
  }
  const da = (await res.json()) as DeviceAuthResponse;
  if (!da.verification_uri) {
    throw new Error(
      "Device auth returned no verification_uri — is Hydra's device flow configured?",
    );
  }
  return da;
}

/** Poll /oauth2/token (device grant) until authorized / denied / expired. */
async function pollDeviceToken(
  base: string,
  deviceCode: string,
  clientId: string,
  intervalMs: number,
  windowMs: number,
): Promise<OAuthTokens> {
  let interval = intervalMs;
  const deadline = Date.now() + windowMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    const tokRes = await fetch(
      `${base}/oauth2/token`,
      form({ grant_type: DEVICE_GRANT, device_code: deviceCode, client_id: clientId }),
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

/** Device-code login: request code → caller surfaces it (browser/print) → poll. */
export async function deviceLogin(
  baseUrl: string,
  opts: DeviceLoginOptions = {},
): Promise<OAuthTokens> {
  const base = normalizeBaseUrl(baseUrl);
  const clientId = opts.clientId ?? DEFAULT_DEVICE_CLIENT_ID;
  const da = await requestDeviceCode(base, clientId, opts.scope ?? DEVICE_SCOPE, opts.audience);
  // Hydra may advertise an internal host (e.g. its container name) in the
  // verification URIs; present them on the base URL the user actually reached.
  opts.onPrompt?.({
    userCode: da.user_code,
    verificationUri: onBaseHost(base, da.verification_uri),
    verificationUriComplete: da.verification_uri_complete
      ? onBaseHost(base, da.verification_uri_complete)
      : undefined,
  });
  const windowMs = Math.min(opts.timeoutMs ?? Number.POSITIVE_INFINITY, da.expires_in * 1000);
  return pollDeviceToken(base, da.device_code, clientId, (da.interval ?? 5) * 1000, windowMs);
}

/** Re-host a URL onto the base origin, keeping its path + query. */
function onBaseHost(base: string, uri: string): string {
  try {
    const u = new URL(uri);
    const b = new URL(base);
    return `${b.origin}${u.pathname}${u.search}`;
  } catch {
    return uri;
  }
}

/**
 * Headless credential login over the device flow: request a device code, then
 * drive bkn-safe's verify → /device → /login (account/password) → /consent
 * (allow) pages server-to-server with a cookie jar, then poll the token. No
 * browser, no callback server. The only seeded user client is the device client
 * (`openbkn-sdk`), so password login rides the device_code grant.
 */
export async function credentialDeviceLogin(
  baseUrl: string,
  username: string,
  password: string,
  opts: DeviceLoginOptions = {},
): Promise<OAuthTokens> {
  const base = normalizeBaseUrl(baseUrl);
  const clientId = opts.clientId ?? DEFAULT_DEVICE_CLIENT_ID;
  const da = await requestDeviceCode(base, clientId, opts.scope ?? DEVICE_SCOPE, opts.audience);

  let jar = "";
  const hop = async (url: string, init?: RequestInit) => {
    const r = await fetch(url, {
      method: init?.method ?? "GET",
      headers: { Cookie: jar, Accept: "text/html,*/*;q=0.8", ...(init?.headers ?? {}) },
      body: init?.body,
      redirect: "manual",
    });
    jar = mergeCookies(jar, r);
    return r;
  };
  const postForm = (path: string, body: Record<string, string>) =>
    hop(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    });

  // verify → /device?device_challenge, then walk the form chain to approval.
  const v = await hop(`${base}/oauth2/device/verify?user_code=${encodeURIComponent(da.user_code)}`);
  let loc = v.headers.get("location");
  for (let i = 0; i < 25 && loc; i++) {
    const u = new URL(loc, base);
    let r: Response;
    if (u.pathname.endsWith("/device")) {
      const dc = u.searchParams.get("device_challenge");
      if (!dc) throw new Error(`/device without device_challenge: ${loc}`);
      r = await postForm("/device", { device_challenge: dc, user_code: da.user_code });
    } else if (u.pathname.endsWith("/login")) {
      const lc = u.searchParams.get("login_challenge");
      if (!lc) throw new Error(`/login without login_challenge: ${loc}`);
      r = await postForm("/login", { login_challenge: lc, account: username, password });
      if (r.status === 401) throw new InputError("Sign-in failed: wrong account or password");
    } else if (u.pathname.endsWith("/consent")) {
      const cc = u.searchParams.get("consent_challenge");
      if (!cc) throw new Error(`/consent without consent_challenge: ${loc}`);
      r = await postForm("/consent", { consent_challenge: cc, decision: "allow" });
    } else {
      r = await hop(u.href);
    }
    loc = r.headers.get("location");
  }

  // Approval submitted — poll the device token.
  const windowMs = Math.min(opts.timeoutMs ?? Number.POSITIVE_INFINITY, da.expires_in * 1000);
  return pollDeviceToken(base, da.device_code, clientId, (da.interval ?? 5) * 1000, windowMs);
}
