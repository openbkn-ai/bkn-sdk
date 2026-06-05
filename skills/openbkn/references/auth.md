# auth — authentication & session

Credentials are stored per platform/user under `~/.bkn/` (`BKN_CONFIG_DIR` overrides).
The `openbkn admin auth …` leaves are identical (same handlers).

| Command | Notes |
|---------|-------|
| `auth login <url> --token <t>` | Attach an existing token (CI / headless). |
| `auth login <url> -u <user> -p <pwd>` | Headless OAuth password sign-in (RSA-encrypted password → `/oauth2/signin`). Extra: `--client-id`, `--client-secret`, `--port`, `--signin-public-key-file`, `--product`. |
| `auth login <url>` | Browser PKCE: registers a Hydra client, opens the authorize URL, catches the loopback callback. `--no-browser` prints the URL instead. |
| `auth status` / `token` / `whoami [url]` | Session state / print access token / identity (decodes id_token; `--no-lookup` skips the backend fallback). |
| `auth list` / `use <url>` / `logout` / `delete <url>` | Platform sessions. |
| `auth switch <url> <user-id>` / `users <url>` / `export` | Multi-user: pick active user, list profiles, dump active tokens for a headless host. |
| `auth change-password [url] -a <acct> --old-password <p> --new-password <p>` | EACP modifypassword (RSA old+new). `--public-key-file` overrides the key. |

Gotchas: self-signed platform → pass `-k`; opaque Ory access tokens aren't JWTs (whoami uses the id_token). Don't run `auth status` as a pre-check — just run the target command.
