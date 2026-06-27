# appkey — user-issued AppKeys (`bak_`) for the Context Loader

AppKeys are **long-lived credentials a user issues for themselves**. They
authenticate **as the issuer** — downstream authorization is identical to that
user's OAuth token, not a separate permission set. Two sides:

- **Manage** (`openbkn appkey …`): needs a real **OAuth session** (`auth login`
  / `--token <oauth>`), exactly like `/me` and `admin`. An AppKey **cannot** mint
  AppKeys — no privilege-escalation chain.
- **Use** (`--token bak_…`): drop-in bearer for the **Context Loader only**
  (`openbkn context …` / agent-retrieval MCP+REST). Other services still need an
  OAuth token.

| Command | Notes |
|---------|-------|
| `appkey list` | Your own keys. No secrets; each carries a `masked` preview (`bak_b3ff****b234`) for display. `last_used_at: null` = never used (zombie). |
| `appkey create --name <s> [--expires-at <rfc3339>] [--expire-days <n>] [--never-expire]` | Issue a key. **The `key` field (plaintext) is returned ONCE** — copy it now. Default expiry 1 year. See [§ create](#appkey-create). |
| `appkey regenerate <id>` (alias `rotate`) | Rotate in place: keep the same record `id`, mint a **new plaintext `key`** (shown once); the old `bak_…` stops working **immediately**. See [§ regenerate](#appkey-regenerate). |
| `appkey revoke <id>` (alias `delete`, `rm`) | Revoke immediately. Use the **`id`**, not `key_id`. 404 if not yours. |
| `appkey admin list [--owner-id <id>]` | **Admin**: all keys (or one owner's); adds `owner_user_id`. |
| `appkey admin revoke <id>` (alias `delete`, `rm`) | **Admin**: revoke any key. |

## `appkey create`

`POST /api/safe/v1/me/api-keys`. Returns `201` with the full plaintext `key`
(`bak_<keyid>_<secret>`) **exactly once** — the list endpoint never returns it
again. Copy + store it on issue; if lost, revoke and re-issue.

```bash
# Default — expires in 1 year
openbkn appkey create --name "my Cursor"

# Custom expiry (either form)
openbkn appkey create --name ci-bot --expire-days 90
openbkn appkey create --name ci-bot --expires-at 2027-01-01T00:00:00Z

# Never expire (use sparingly — long-lived standing credential)
openbkn appkey create --name kiosk --never-expire
```

| Flag | Required | Default | Notes |
|------|----------|---------|-------|
| `--name <s>` | ✅ | — | Display name, to tell keys apart. |
| `--expires-at <rfc3339>` | optional | 1 year | RFC3339; must be in the future (else `400`). |
| `--expire-days <n>` | optional | — | Convenience: expiry N days from now. Mutually exclusive with `--expires-at`. |
| `--never-expire` | optional | — | Never expire. Wins over the two above. |

## `appkey regenerate`

`POST /api/safe/v1/me/api-keys/:id/regenerate`. Rotate a key **in place**: the
record keeps its `id`, `name` and expiry, but gets a brand-new secret. The
response carries the new plaintext `key` (shown once, like `create`); the old
`bak_…` string **stops working immediately**.

```bash
openbkn appkey regenerate <id>     # alias: rotate
```

Use it to refresh a credential without touching client config that references
the key by `id`/`name` — but every place that hard-codes the old `bak_…` string
must be updated to the new one, or it will `401`. Lost-but-not-revoked key →
prefer `regenerate` over revoke + re-create (keeps the same record).

## Using a key (SDK / MCP client)

The key is a normal bearer — no new headers. Against the Context Loader:

```bash
# REST / MCP via the CLI
openbkn --base-url https://<host> --token bak_<keyid>_<secret> context info

# MCP client config (Cursor / Claude Desktop): one header, drop-in
#   "headers": { "Authorization": "Bearer bak_<keyid>_<secret>" }
# Replaces the easily-expiring ory_at_… token; no x-account-id / x-account-type.
```

`createClient({ baseUrl, token: "bak_…" })` works the same way in the SDK.

## Gotchas

- **Scope = Context Loader only.** An AppKey on `bkn` / `vega` / `admin` /
  `appkey` itself → `401`. Those need an OAuth token.
- **Plaintext is one-time.** `list` only ever shows metadata. Lost key → revoke +
  re-issue, never "recover".
- **Revoke is immediate.** The backend checks on every call — a revoked/expired
  key, or a key whose owner was disabled, fails the *next* request with `401`.
- **`id` vs `key_id`.** Revoke by `id` (the record id). `key_id` is the public
  prefix inside the key string; it is **not** the revoke handle.
- **`401` on use** = key invalid / expired / revoked / owner disabled → re-issue
  from the management page or `appkey create`; don't auto-retry.
