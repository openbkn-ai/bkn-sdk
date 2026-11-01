// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * Sign-in flows for an app that signs its own users in: self-registration of a
 * public client, the authorization_code grant with PKCE (loopback or web), and
 * the refresh grant. Endpoints are fixed paths on the platform origin, like the
 * rest of `auth/`; there is no discovery. Node built-ins only.
 */
import { createHash, randomBytes } from "node:crypto";
import { type Server, createServer } from "node:http";
import { tlsFetch } from "../api/tls.js";
import { InputError } from "../utils/errors.js";
import {
  type OAuthTokens,
  form,
  isHeadless,
  mapToken,
  normalizeBaseUrl,
  openBrowser as spawnBrowser,
} from "./oauth.js";

/** The callback Studio registers by default for a desktop/CLI app. */
export const DEFAULT_REDIRECT_URI = "http://127.0.0.1:8765/callback";
const DEFAULT_SCOPE = "openid offline";
const DEFAULT_LOGIN_TIMEOUT_MS = 300_000;

export interface RegisterClientOptions {
  clientName: string;
  /** Defaults to {@link DEFAULT_REDIRECT_URI}. */
  redirectUris?: string[];
  insecure?: boolean;
}

export interface RegisteredClient {
  clientId: string;
  clientName: string;
  redirectUris: string[];
}

export interface AuthorizationRequestOptions {
  clientId: string;
  /** Defaults to {@link DEFAULT_REDIRECT_URI}. */
  redirectUri?: string;
  /** Defaults to `"openid offline"`. */
  scope?: string;
}

/** What `authorizationRequest` returns; keep it until the callback arrives. */
export interface AuthorizationRequest {
  /** Send the user's browser here. */
  url: string;
  state: string;
  /** PKCE verifier (S256). Secret: keep server-side, session-bound. */
  codeVerifier: string;
  clientId: string;
  redirectUri: string;
}

export interface ExchangeCodeOptions {
  /** The `code` query parameter of the callback. */
  code: string;
  /** The `state` query parameter of the callback. */
  state: string;
  insecure?: boolean;
}

export interface LoginOptions extends AuthorizationRequestOptions {
  /** Open the system browser (default true; skipped when the machine is headless). */
  openBrowser?: boolean;
  /** Called with the sign-in URL; defaults to printing it on stderr. */
  onUrl?: (url: string) => void;
  /** How long to wait for the callback (ms). Default 300 000. */
  timeoutMs?: number;
  insecure?: boolean;
}

export interface RefreshOptions {
  /** The client the tokens were issued to. */
  clientId: string;
  insecure?: boolean;
}

const b64url = (n: number) => randomBytes(n).toString("base64url");

/** RFC 7636 S256 challenge for a verifier. */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** Why the platform refused, from an OAuth/JSON error body (never tokens). */
async function failure(res: Response): Promise<{ error?: string; description: string }> {
  const text = await res.text().catch(() => "");
  try {
    const j = JSON.parse(text) as {
      error?: unknown;
      error_description?: unknown;
      message?: unknown;
    };
    const error = typeof j.error === "string" ? j.error : undefined;
    const description =
      (typeof j.error_description === "string" && j.error_description) ||
      (typeof j.message === "string" && j.message) ||
      error ||
      `HTTP ${res.status}`;
    return { error, description };
  } catch {
    return { description: text.trim().slice(0, 200) || `HTTP ${res.status}` };
  }
}

export async function registerClient(
  baseUrl: string,
  opts: RegisterClientOptions,
): Promise<RegisteredClient> {
  const base = normalizeBaseUrl(baseUrl);
  const redirectUris = opts.redirectUris ?? [DEFAULT_REDIRECT_URI];
  const res = await tlsFetch(opts.insecure, `${base}/api/safe/v1/oauth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_name: opts.clientName, redirect_uris: redirectUris }),
  });
  if (res.status === 404 || res.status === 405) {
    throw new InputError(
      "This platform does not let clients register themselves (releases up to 0.2.0 have no self-registration, or an operator disabled it). Use `oauth.deviceLogin`, or ask an operator to register a client for your app.",
    );
  }
  if (!res.ok) {
    throw new InputError(`Client registration failed: ${(await failure(res)).description}`);
  }
  const j = (await res.json()) as {
    client_id: string;
    client_name?: string;
    redirect_uris?: string[];
  };
  return {
    clientId: j.client_id,
    clientName: j.client_name ?? opts.clientName,
    redirectUris: j.redirect_uris ?? redirectUris,
  };
}

/** Build the sign-in URL with a fresh PKCE verifier and state. Pure, no I/O. */
export function authorizationRequest(
  baseUrl: string,
  opts: AuthorizationRequestOptions,
): AuthorizationRequest {
  const redirectUri = opts.redirectUri ?? DEFAULT_REDIRECT_URI;
  const state = b64url(24);
  const codeVerifier = b64url(32);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: opts.clientId,
    redirect_uri: redirectUri,
    scope: opts.scope ?? DEFAULT_SCOPE,
    state,
    code_challenge: pkceChallenge(codeVerifier),
    code_challenge_method: "S256",
  });
  return {
    url: `${normalizeBaseUrl(baseUrl)}/oauth2/auth?${params.toString()}`,
    state,
    codeVerifier,
    clientId: opts.clientId,
    redirectUri,
  };
}

/** Check `state`, then swap the callback's `code` for tokens. */
export async function exchangeCode(
  baseUrl: string,
  request: AuthorizationRequest,
  opts: ExchangeCodeOptions,
): Promise<OAuthTokens> {
  if (opts.state !== request.state) {
    throw new InputError("Sign-in failed: the callback's state does not match the request.");
  }
  const res = await tlsFetch(
    opts.insecure,
    `${normalizeBaseUrl(baseUrl)}/oauth2/token`,
    form({
      grant_type: "authorization_code",
      code: opts.code,
      redirect_uri: request.redirectUri,
      client_id: request.clientId,
      code_verifier: request.codeVerifier,
    }),
  );
  if (!res.ok) {
    throw new InputError(`Sign-in failed: ${(await failure(res)).description}`);
  }
  return mapToken((await res.json()) as { access_token: string });
}

/** The refresh grant. Keeps the old refresh token when the response carries none. */
export async function refresh(
  baseUrl: string,
  tokens: { refreshToken?: string },
  opts: RefreshOptions,
): Promise<OAuthTokens> {
  if (!tokens.refreshToken) {
    throw new InputError("No refresh token to renew with. Sign the user in again.");
  }
  const res = await tlsFetch(
    opts.insecure,
    `${normalizeBaseUrl(baseUrl)}/oauth2/token`,
    form({
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
      client_id: opts.clientId,
    }),
  );
  if (!res.ok) {
    throw new InputError(
      `Token refresh failed: ${(await failure(res)).description}. Sign the user in again.`,
    );
  }
  const next = mapToken((await res.json()) as { access_token: string });
  return { ...next, refreshToken: next.refreshToken ?? tokens.refreshToken };
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function loopbackRedirect(redirectUri: string): URL {
  let url: URL | undefined;
  try {
    url = new URL(redirectUri);
  } catch {
    /* handled below */
  }
  if (!url || url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new InputError(
      `\`login\` serves loopback callbacks only (http://127.0.0.1, localhost or [::1]); got ${redirectUri}. A web app handles its own callback: use \`authorizationRequest\` to build the URL and \`exchangeCode\` in your handler.`,
    );
  }
  return url;
}

function listen(server: Server, redirect: URL): Promise<void> {
  const host = redirect.hostname.replace(/^\[|\]$/g, "");
  const port = redirect.port ? Number(redirect.port) : 80;
  return new Promise((resolve, reject) => {
    server.once("error", (err: NodeJS.ErrnoException) =>
      reject(
        new InputError(
          err.code === "EADDRINUSE"
            ? `Cannot listen on ${redirect.host} for the sign-in callback: the port is in use. Pick another \`redirectUri\` port (it must be registered for the client).`
            : `Cannot listen on ${redirect.host} for the sign-in callback: ${err.message}`,
          { cause: err },
        ),
      ),
    );
    server.listen(port, host, () => resolve());
  });
}

/** The whole loopback flow: listen, open the browser, take the callback, exchange. */
export async function login(baseUrl: string, opts: LoginOptions): Promise<OAuthTokens> {
  const redirect = loopbackRedirect(opts.redirectUri ?? DEFAULT_REDIRECT_URI);
  const request = authorizationRequest(baseUrl, opts);

  let onCallback: (r: { code: string; state: string }) => void = () => {};
  let onFail: (e: Error) => void = () => {};
  const callback = new Promise<{ code: string; state: string }>((resolve, reject) => {
    onCallback = resolve;
    onFail = reject;
  });
  // The wait is only observed after the browser step; keep an early rejection quiet.
  callback.catch(() => {});

  let answered = false;
  const reply = (res: import("node:http").ServerResponse, status: number, text: string) => {
    res.writeHead(status, {
      "Content-Type": "text/plain; charset=utf-8",
      Connection: "close",
    });
    res.end(text);
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", redirect);
    if (answered || url.pathname !== redirect.pathname) {
      reply(res, 404, "Not found");
      return;
    }
    answered = true;
    const err = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (err) {
      const why = url.searchParams.get("error_description") || err;
      reply(res, 400, `Sign-in failed: ${why}. You can close this page.`);
      onFail(new InputError(`Sign-in was not completed: ${why}`));
    } else if (state !== request.state) {
      reply(res, 400, "Sign-in failed: state mismatch. You can close this page.");
      onFail(new InputError("Sign-in failed: the callback's state does not match the request."));
    } else if (!code) {
      reply(res, 400, "Sign-in failed: no authorization code. You can close this page.");
      onFail(new InputError("Sign-in failed: the callback carried no authorization code."));
    } else {
      reply(res, 200, "Signed in. You can close this page.");
      onCallback({ code, state });
    }
  });

  let timer: NodeJS.Timeout | undefined;
  try {
    await listen(server, redirect);
    const timeoutMs = opts.timeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new InputError(
              `Sign-in timed out after ${Math.round(timeoutMs / 1000)}s: no callback.`,
            ),
          ),
        timeoutMs,
      );
    });
    // Listening first: a user with a live session is redirected back at once.
    (opts.onUrl ?? ((u: string) => process.stderr.write(`Open this URL to sign in:\n${u}\n`)))(
      request.url,
    );
    if (opts.openBrowser !== false && !isHeadless()) spawnBrowser(request.url);
    const got = await Promise.race([callback, timeout]);
    return await exchangeCode(baseUrl, request, { ...got, insecure: opts.insecure });
  } finally {
    if (timer) clearTimeout(timer);
    server.close();
    server.closeAllConnections();
  }
}
