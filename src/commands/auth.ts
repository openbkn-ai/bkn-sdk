/** `openbkn auth …` — login / session / token (store-backed). */
import { Command } from "commander";
import { browserLogin, passwordLogin } from "../auth/oauth.js";
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
    .option("--no-browser", "headless: do not open a browser")
    .action((url: string, opts, cmd: Command) => {
      // --token and --insecure are global flags; read them via merged globals.
      const g = cmd.optsWithGlobals();
      if (g.token) {
        const r = auth.attachToken(url, g.token, { insecure: g.insecure });
        printJson({ loggedIn: true, ...r }, outputOptions(cmd));
        return;
      }
      if (opts.username) passwordLogin(url, opts.username, opts.password ?? "");
      browserLogin(url);
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

  // Staged: need backend/OAuth contracts before these are real (see oauth.ts).
  for (const [name, desc] of [
    ["switch", "Switch the active user for a platform"],
    ["users", "List user profiles for a platform"],
    ["change-password", "Change account password"],
    ["export", "Export credentials for a headless host"],
  ] as const) {
    cmd
      .command(name)
      .description(`${desc} (pending)`)
      .allowUnknownOption()
      .action(() => {
        throw new Error(`\`openbkn auth ${name}\` is not implemented yet.`);
      });
  }

  return group(cmd, "AUTHENTICATION & CONFIG");
}
