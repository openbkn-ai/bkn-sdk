/** `openbkn auth …` — login / session / token (store-backed). */
import { createInterface } from "node:readline";
import { Command } from "commander";
import { changePassword } from "../api/admin.js";
import { credentialDeviceLogin, deviceLogin, openBrowser } from "../auth/oauth.js";
import { resolveContext } from "../config/resolve.js";
import { group } from "../help/grouped-help.js";
import * as auth from "../resources/auth.js";
import { printJson } from "../utils/output.js";
import { outputOptions } from "./_shared.js";

/** Prompt for a line on the TTY; when `hidden`, the typed characters are not echoed. */
function promptLine(query: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    if (hidden) {
      // Swallow the echo of typed chars; print the query once up front.
      const mutable = rl as unknown as { _writeToOutput: (s: string) => void };
      mutable._writeToOutput = (s: string) => {
        if (s.startsWith(query)) process.stdout.write(query);
      };
    }
    rl.question(query, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

/** Register the auth leaves onto a parent (shared by top-level `auth` + `admin auth`). */
export function registerAuthLeaves(cmd: Command): void {
  cmd
    .command("login <url>")
    .description("Log in to a platform (attach a token, or browser/password OAuth)")
    .option("-u, --username <name>", "username for password signin")
    .option("-p, --password <pwd>", "password for password signin")
    .option("--token <token>", "provide a token directly (CI / headless)")
    .option("--client-id <id>", "use a fixed OAuth2 client id (skip dynamic registration)")
    .option("--client-secret <secret>", "OAuth2 client secret (omit for public/PKCE)")
    .option("--port <n>", "loopback redirect port for the auth_code flow", (v) =>
      Number.parseInt(v, 10),
    )
    .option("--device", "headless device-code login (RFC 8628) — no callback server, no password")
    .option("--audience <aud>", "device-code token audience", "bkn-safe")
    // Legacy ISF sign-in flags — accepted for compatibility, ignored by the
    // bkn-safe device-code flow.
    .option("--no-browser", "(legacy) print the URL instead of opening a browser")
    .option("--product <name>", "(legacy) ISF OAuth product query")
    .option("--signin-public-key-file <path>", "(legacy) RSA public key for ISF /oauth2/signin")
    .action(async (url: string, opts, cmd: Command) => {
      const g = cmd.optsWithGlobals();
      if (g.insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
      const token = opts.token ?? g.token;
      if (token) {
        const r = auth.attachToken(url, token, { insecure: g.insecure });
        printJson({ loggedIn: true, ...r }, outputOptions(cmd));
        return;
      }
      // All flows ride the device_code grant (the only seeded user client):
      //  --device      → print the URL/code; approve on any machine (headless).
      //  -u/-p         → CLI drives login/consent with the credentials (CI).
      //  default       → open the browser; user signs in + approves there.
      let tokens: Awaited<ReturnType<typeof deviceLogin>>;
      if (opts.username || opts.password) {
        const username = opts.username ?? (await promptLine("用户名: "));
        const password = opts.password ?? (await promptLine("密码: ", true));
        tokens = await credentialDeviceLogin(url, username, password, {
          clientId: opts.clientId,
          audience: opts.audience,
        });
      } else {
        // open the browser unless headless (--device) or --no-browser.
        const openInBrowser = !opts.device && opts.browser !== false;
        tokens = await deviceLogin(url, {
          clientId: opts.clientId,
          audience: opts.audience,
          onPrompt: ({ userCode, verificationUri, verificationUriComplete }) => {
            const target = verificationUriComplete ?? verificationUri;
            process.stderr.write(`\n打开下面的链接登录并授权:\n  ${target}\n验证码: ${userCode}\n`);
            if (openInBrowser) openBrowser(target);
            process.stderr.write("等待授权…\n");
          },
        });
      }
      const r = auth.attachToken(url, tokens.accessToken, {
        refreshToken: tokens.refreshToken,
        idToken: tokens.idToken,
        insecure: g.insecure,
      });
      printJson({ loggedIn: true, ...r }, outputOptions(cmd));
    });

  cmd
    .command("status")
    .description("Show base URL and whether a token is configured")
    .action((_opts, cmd: Command) => printJson(auth.status(), outputOptions(cmd)));

  cmd
    .command("token")
    .description("Print the current access token (keep secret)")
    .action(() => {
      process.stdout.write(`${auth.currentToken()}\n`);
    });

  cmd
    .command("whoami [url]")
    .description("Show current user identity (from the token)")
    .option("--no-lookup", "skip the backend identity fallback (eacp/user/get)")
    .action((_url: string | undefined, _opts, cmd: Command) =>
      printJson(auth.whoami(), outputOptions(cmd)),
    );

  cmd
    .command("list")
    .alias("ls")
    .description("List platforms with a saved session")
    .action((_opts, cmd: Command) => printJson(auth.listPlatforms(), outputOptions(cmd)));

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
    .command("switch <url> <user-id>")
    .description("Switch the active user for a platform")
    .action((url: string, userId: string, _opts, cmd: Command) => {
      printJson(auth.switchUser(url, userId), outputOptions(cmd));
    });

  cmd
    .command("users <url>")
    .description("List saved user profiles for a platform")
    .action((url: string, _opts, cmd: Command) => {
      printJson(auth.usersOf(url), outputOptions(cmd));
    });

  cmd
    .command("export")
    .description("Export the active session's tokens (for a headless host)")
    .action((_opts, cmd: Command) => {
      printJson(auth.exportCreds(), outputOptions(cmd));
    });

  cmd
    .command("change-password [url]")
    .description("Change your account password (EACP, RSA-encrypted in transit)")
    .requiredOption("-a, --account <name>", "account / login name")
    .requiredOption("--old-password <pwd>", "current password")
    .requiredOption("--new-password <pwd>", "new password")
    .option("--public-key-file <path>", "override the RSA public key (PEM) for password encryption")
    .action(async (_url: string | undefined, opts, cmd: Command) => {
      const g = cmd.optsWithGlobals();
      const ctx = resolveContext({
        baseUrl: g.baseUrl,
        token: g.token,
        user: g.user,
        businessDomain: g.bizDomain,
        insecure: g.insecure,
      });
      printJson(
        await changePassword(ctx, opts.account, opts.oldPassword, opts.newPassword),
        outputOptions(cmd),
      );
    });
}

export function authCommand(): Command {
  const cmd = new Command("auth").description("Login, session, and token management");
  registerAuthLeaves(cmd);
  return group(cmd, "AUTHENTICATION & CONFIG");
}
