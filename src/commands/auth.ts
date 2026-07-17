// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** `openbkn auth …` — login / session / token (store-backed). */
import { Command } from "commander";
import { changePasswordSafe, getUserSafe } from "../api/safe.js";
import { decodeJwt } from "../auth/jwt.js";
import { credentialDeviceLogin, deviceLogin, isHeadless, openBrowser } from "../auth/oauth.js";
import { resolveContext } from "../config/resolve.js";
import { group } from "../help/grouped-help.js";
import * as auth from "../resources/auth.js";
import { DEFAULT_BUSINESS_DOMAIN } from "../types.js";
import { HttpError, InputError } from "../utils/errors.js";
import { printJson } from "../utils/output.js";
import { promptLine } from "../utils/prompt.js";
import { outputOptions } from "./_shared.js";

/** Best-effort: resolve the logged-in user's account name from their token. */
async function resolveAccount(
  baseUrl: string,
  accessToken: string,
  insecure: boolean,
  idToken?: string,
): Promise<string | undefined> {
  const sub = decodeJwt(idToken ?? accessToken)?.sub;
  if (!sub) return undefined;
  try {
    const u = (await getUserSafe(
      { baseUrl, token: accessToken, businessDomain: DEFAULT_BUSINESS_DOMAIN, insecure },
      sub,
    )) as { account?: string };
    return u.account; // needs admin; ignored on 403 for non-admins
  } catch {
    return undefined;
  }
}

/** Render saved sessions as a tree: platform → users, `*` marks the active one. */
function renderSessions(items: auth.PlatformListItem[]): string {
  const byPlatform = new Map<string, auth.PlatformListItem[]>();
  for (const it of items) {
    const arr = byPlatform.get(it.baseUrl) ?? [];
    arr.push(it);
    byPlatform.set(it.baseUrl, arr);
  }
  const lines: string[] = [];
  for (const [platform, users] of byPlatform) {
    lines.push(platform);
    for (const u of users) lines.push(`  ${u.active ? "*" : " "} ${u.username ?? u.userId}`);
  }
  return lines.join("\n") || "(no saved sessions)";
}

/** Register the auth leaves onto a parent (shared by top-level `auth` + `admin auth`). */
export function registerAuthLeaves(cmd: Command): void {
  cmd
    .command("login <url>")
    .description("Log in to a platform (attach a token, or browser/password OAuth)")
    .option("-u, --username <name>", "username for password signin")
    .option("-p, --password <pwd>", "password for password signin")
    .option("--token <token>", "provide a token directly (CI / headless)")
    .option("--client-id <id>", "OAuth2 client id to authenticate as")
    .option("--device", "headless device-code login (RFC 8628) — no callback server, no password")
    .option("--audience <aud>", "device-code token audience", "bkn-safe")
    .option(
      "--timeout <s>",
      "device-login wait before timing out",
      (v) => Number.parseInt(v, 10),
      120,
    )
    .option("--no-browser", "print the URL instead of opening a browser")
    .action(async (url: string, opts, cmd: Command) => {
      const g = cmd.optsWithGlobals();
      const out = outputOptions(cmd);
      const report = (r: { baseUrl?: string; userId?: string; username?: string }) => {
        if (out.json || out.compact) {
          printJson({ loggedIn: true, ...r }, out);
        } else {
          process.stdout.write(`Logged in to ${r.baseUrl ?? url} as ${r.username ?? r.userId}\n`);
        }
      };
      const token = opts.token ?? g.token;
      if (token) {
        report(auth.attachToken(url, token));
        return;
      }
      // All flows ride the device_code grant (the only seeded user client):
      //  --device      → print the URL/code; approve on any machine (headless).
      //  -u/-p         → CLI drives login/consent with the credentials (CI).
      //  default       → open the browser; user signs in + approves there.
      let tokens: Awaited<ReturnType<typeof deviceLogin>>;
      let account: string | undefined;
      try {
        if (opts.username || opts.password) {
          const username = opts.username ?? (await promptLine("Username: "));
          account = username;
          const password = opts.password ?? (await promptLine("Password: ", true));
          tokens = await credentialDeviceLogin(url, username, password, {
            clientId: opts.clientId,
            audience: opts.audience,
            timeoutMs: opts.timeout * 1000,
            insecure: g.insecure,
          });
        } else {
          // Open the browser unless asked not to (--device / --no-browser) or
          // there's none to open (headless server). On a headless box we just
          // print the URL/code — approve it on any machine with a browser.
          const headless = isHeadless();
          const openInBrowser = !opts.device && opts.browser !== false && !headless;
          tokens = await deviceLogin(url, {
            clientId: opts.clientId,
            audience: opts.audience,
            timeoutMs: opts.timeout * 1000,
            insecure: g.insecure,
            onPrompt: ({ userCode, verificationUri, verificationUriComplete }) => {
              const target = verificationUriComplete ?? verificationUri;
              process.stderr.write(
                `\nOpen this URL to sign in and authorize:\n  ${target}\nUser code: ${userCode}\n`,
              );
              if (openInBrowser) openBrowser(target);
              else if (headless && !opts.device && opts.browser !== false)
                process.stderr.write("(headless — approve on any machine with a browser)\n");
              process.stderr.write("Waiting for authorization…\n");
            },
          });
        }
      } catch (e) {
        // No device-auth endpoint → the platform has no auth stack (no bkn-safe).
        // Unauthenticated sessions are not supported: the platform needs bkn-safe.
        if (e instanceof Error && /Device auth failed \(404\)/.test(e.message)) {
          throw new InputError(
            `No auth endpoint on ${url} — the platform has no bkn-safe auth stack. Deploy bkn-safe, or log in elsewhere and pass the token with \`--token\`.`,
          );
        }
        throw e;
      }
      // For browser/device logins (no -u), look the account name up so the
      // session list shows a name, not a UUID.
      if (!account) {
        account = await resolveAccount(
          url,
          tokens.accessToken,
          Boolean(g.insecure),
          tokens.idToken,
        );
      }
      report(
        auth.attachToken(url, tokens.accessToken, {
          refreshToken: tokens.refreshToken,
          idToken: tokens.idToken,
          username: account,
        }),
      );
    });

  cmd
    .command("status")
    .description("Show base URL and whether a token is configured")
    .action((_opts, cmd: Command) => printJson(auth.status(), outputOptions(cmd)));

  cmd
    .command("token")
    .description("Print the current access token, refreshing it if expired (keep secret)")
    .option("--no-refresh", "print the stored token as-is, without refreshing")
    .action(async (opts, cmd: Command) => {
      const g = cmd.optsWithGlobals();
      const token =
        opts.refresh === false
          ? auth.currentToken()
          : await auth.currentTokenFresh({ insecure: g.insecure });
      process.stdout.write(`${token}\n`);
    });

  cmd
    .command("whoami [url]")
    .description("Show current user identity (from the token)")
    .option("--no-lookup", "skip the backend identity fallback (eacp/user/get)")
    .action(async (_url: string | undefined, opts, cmd: Command) => {
      const g = cmd.optsWithGlobals();
      const me = auth.whoami();
      // The device-flow id_token carries only `sub` (a UUID), so the token
      // alone can't say *who* you are. Resolve the account name from the
      // backend (needs admin; best-effort — skipped with --no-lookup).
      if (opts.lookup !== false && me.baseUrl && me.sub) {
        try {
          const u = (await getUserSafe(
            {
              baseUrl: me.baseUrl,
              token: auth.currentToken(),
              businessDomain: DEFAULT_BUSINESS_DOMAIN,
              insecure: Boolean(g.insecure),
            },
            me.sub,
          )) as { account?: string; name?: string };
          if (u.account) me.username = u.account;
          if (u.name) me.name = u.name;
        } catch {
          /* not an admin / offline — fall back to token claims */
        }
      }
      const out = outputOptions(cmd);
      // --json/--compact/--full → the complete claim set. Default → a trimmed,
      // human summary of the key identity fields (the raw JWT is mostly noise).
      if (out.json || out.compact || out.full) {
        printJson(me, out);
        return;
      }
      const expMs = typeof me.exp === "number" ? me.exp * 1000 : undefined;
      const expired = expMs !== undefined && expMs < Date.now();
      const rows: [string, string][] = [
        ["User", String(me.username ?? me.sub ?? "(unknown)")],
        ...(me.name && me.name !== me.username
          ? ([["Name", String(me.name)]] as [string, string][])
          : []),
        ["ID", String(me.userId ?? me.sub ?? "-")],
        ["Platform", String(me.baseUrl ?? "-")],
        ...(expMs !== undefined
          ? ([["Expires", `${new Date(expMs).toISOString()}${expired ? " (expired)" : ""}`]] as [
              string,
              string,
            ][])
          : []),
      ];
      const pad = Math.max(...rows.map(([k]) => k.length));
      process.stdout.write(
        `${rows.map(([k, v]) => `${k.padEnd(pad)}  ${v}`).join("\n")}\n… use --full or --json for all claims\n`,
      );
    });

  cmd
    .command("list")
    .alias("ls")
    .description("List saved sessions (platform → users; * = active)")
    .action((_opts, cmd: Command) => {
      const items = auth.listPlatforms();
      const out = outputOptions(cmd);
      if (out.json || out.compact) printJson(items, out);
      else process.stdout.write(`${renderSessions(items)}\n`);
    });

  cmd
    .command("use <url>")
    .description("Switch the active platform")
    .action((url: string, _opts, cmd: Command) => {
      auth.use(url);
      printJson(auth.status(), outputOptions(cmd));
    });

  cmd
    .command("logout")
    .description("Remove the stored token for the active platform")
    .action((_opts, cmd: Command) => printJson({ loggedOut: auth.logout() }, outputOptions(cmd)));

  cmd
    .command("delete <url>")
    .description("Delete saved credentials for a platform")
    .action((url: string, _opts, cmd: Command) =>
      printJson({ deleted: auth.deletePlatform(url) }, outputOptions(cmd)),
    );

  cmd
    .command("switch <url> <user>")
    .description("Switch the active user for a platform (by username or user id)")
    .action((url: string, user: string, _opts, cmd: Command) => {
      const r = auth.switchUser(url, user);
      const out = outputOptions(cmd);
      if (out.json || out.compact) printJson(r, out);
      else process.stdout.write(`Switched to ${r.username ?? r.userId} on ${r.baseUrl}\n`);
    });

  cmd
    .command("users <url>")
    .description("List saved users for a platform (* = active)")
    .action((url: string, _opts, cmd: Command) => {
      const norm = url.replace(/\/+$/, "");
      const items = auth.listPlatforms().filter((i) => i.baseUrl === norm);
      const out = outputOptions(cmd);
      if (out.json || out.compact) printJson(items, out);
      else process.stdout.write(`${renderSessions(items)}\n`);
    });

  cmd
    .command("export")
    .description("Export the active session's tokens (for a headless host)")
    .action((_opts, cmd: Command) => {
      printJson(auth.exportCreds(), outputOptions(cmd));
    });

  cmd
    .command("change-password [url]")
    .description("Change your account password (bkn-safe self-service; no browser)")
    .option("-a, --account <name>", "account / login name (the login column, e.g. admin)")
    .option("--old-password <pwd>", "current password")
    .option("--new-password <pwd>", "new password")
    .action(async (url: string | undefined, opts, cmd: Command) => {
      const g = cmd.optsWithGlobals();
      const ctx = resolveContext({
        baseUrl: url ?? g.baseUrl,
        token: g.token,
        user: g.user,
        businessDomain: g.bizDomain,
        insecure: g.insecure,
      });
      const account = opts.account ?? (await promptLine("Account: "));
      const oldPassword = opts.oldPassword ?? (await promptLine("Current password: ", true));
      let newPassword = opts.newPassword;
      if (!newPassword) {
        newPassword = await promptLine("New password: ", true);
        const confirm = await promptLine("Confirm new password: ", true);
        if (newPassword !== confirm) throw new Error("New passwords do not match.");
      }
      try {
        printJson(
          await changePasswordSafe(ctx, account, oldPassword, newPassword),
          outputOptions(cmd),
        );
      } catch (e) {
        // 401 here means bad account/old password, not a missing session;
        // 400 means the new password equals the old one.
        if (e instanceof HttpError && e.status === 401) {
          throw new InputError("Wrong account or current password.");
        }
        if (e instanceof HttpError && e.status === 400) {
          throw new InputError("New password must differ from the current one.");
        }
        throw e;
      }
    });
}

export function authCommand(): Command {
  const cmd = new Command("auth").description("Login, session, and token management");
  registerAuthLeaves(cmd);
  return group(cmd, "AUTHENTICATION & CONFIG");
}
