# auth — authentication & session

Credentials are stored per platform/user under `~/.bkn/` (`BKN_CONFIG_DIR` overrides).
The `openbkn admin auth …` leaves are identical (same handlers).

Every interactive login rides the **device-code grant** (RFC 8628). bkn-safe seeds
one public CLI client (`openbkn-sdk`, `token_endpoint_auth_method=none`), so there
is no dynamic client registration, no loopback callback, and no client secret.

| Command | Notes |
|---------|-------|
| `auth login <url> --token <t>` | Attach an existing token (CI / headless). Carries no refresh token, so it won't auto-renew. |
| `auth login <url>` | Prints the verification URL + user code and opens a browser; sign in and approve there. Headless (or `--no-browser`) prints the URL to approve elsewhere. |
| `auth login <url> --device` | Same, without opening a browser — approve the code on any machine. |
| `auth login <url> -u <user> -p <pwd>` | Headless credential login: drives bkn-safe's verify → /device → /login → /consent pages server-to-server, then polls. Prompts for whichever of `-u`/`-p` is omitted. |
| | Extras: `--client-id` (default `openbkn-sdk`), `--audience` (default `bkn-safe`), `--timeout <s>` (default 120). |
| `auth status` / `token` / `whoami [url]` | Session state / print the access token (refreshes first; `--no-refresh` to skip) / identity (`--no-lookup` skips the backend account lookup). |
| `auth list` / `use <url>` / `logout` / `delete <url>` | Platform sessions. |
| `auth switch <url> <user>` / `users <url>` / `export` | Multi-user: `switch` takes a stored user id **or** the username saved at login; `export` dumps the active tokens for a headless host. |
| `auth change-password [url] -a <acct> --old-password <p> --new-password <p>` | bkn-safe self-service. Prompts for anything omitted. |

Gotchas:

- **Self-signed platform → `auth login -k <url>`.** It's remembered per platform,
  so later commands need no `-k`. The opt-out is scoped to that platform's
  requests — it never touches the process-global TLS setting.
- Opaque Ory access tokens aren't JWTs — `whoami` reads the id_token.
- A platform with no bkn-safe auth stack cannot be registered; there is no
  unauthenticated mode. Issue a token elsewhere and attach it with `--token`.
- Don't run `auth status` as a pre-check — just run the target command.
