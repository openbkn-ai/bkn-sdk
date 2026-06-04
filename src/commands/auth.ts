/** `openbkn auth …` — login / session / token (store-backed). */
import { Command } from "commander";
import { changePassword } from "../api/admin.js";
import { browserLogin, passwordLogin } from "../auth/oauth.js";
import { resolveContext } from "../config/resolve.js";
import { group } from "../help/grouped-help.js";
import * as auth from "../resources/auth.js";
import { printJson } from "../utils/output.js";
import { outputOptions } from "./_shared.js";

export function authCommand(): Command {
  const cmd = new Command("auth").description("Login, session, and token management");

  cmd
    .command("login <url>")
    .description("Log in to a platform (attach a token, or browser/password OAuth)")
    .option("-u, --username <name>", "username for password signin")
    .option("-p, --password <pwd>", "password for password signin")
    .option("--client-id <id>", "use a fixed OAuth2 client id (skip dynamic registration)")
    .option("--no-browser", "headless: print the authorize URL instead of opening a browser")
    .action(async (url: string, opts, cmd: Command) => {
      // --token and --insecure are global flags; read them via merged globals.
      const g = cmd.optsWithGlobals();
      if (g.insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
      if (g.token) {
        const r = auth.attachToken(url, g.token, { insecure: g.insecure });
        printJson({ loggedIn: true, ...r }, outputOptions(cmd));
        return;
      }
      const tokens = opts.username
        ? await passwordLogin(url, opts.username, opts.password ?? "", { clientId: opts.clientId })
        : await browserLogin(url, { clientId: opts.clientId, noBrowser: opts.browser === false });
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
    .command("whoami")
    .description("Show current user identity (from the token)")
    .action((_opts, cmd: Command) => printJson(auth.whoami(), outputOptions(cmd)));

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
    .command("change-password")
    .description("Change your account password (EACP, RSA-encrypted in transit)")
    .requiredOption("-a, --account <name>", "account / login name")
    .requiredOption("--old <pwd>", "current password")
    .requiredOption("--new <pwd>", "new password")
    .action(async (opts, cmd: Command) => {
      const g = cmd.optsWithGlobals();
      const ctx = resolveContext({
        baseUrl: g.baseUrl,
        token: g.token,
        user: g.user,
        businessDomain: g.bizDomain,
        insecure: g.insecure,
      });
      printJson(await changePassword(ctx, opts.account, opts.old, opts.new), outputOptions(cmd));
    });

  return group(cmd, "AUTHENTICATION & CONFIG");
}
