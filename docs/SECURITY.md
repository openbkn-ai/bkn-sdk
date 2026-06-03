# Security

## Tokens & secrets

- Tokens resolve in order: env (`BKN_TOKEN`) → config store `~/.bkn/`. Operator/admin tokens are kept distinct from user tokens.
- Never commit tokens; never write them to logs, error messages, or `--json` output. Redact before printing.
- Config files in `~/.bkn/` should be created with restrictive permissions (user-only).

## Auth flows

- OAuth2 (Hydra-style) login via `auth/oauth`; base URL and TLS settings resolved in `config/`. See [product-specs/identity-access.md](product-specs/identity-access.md).
- A 401/403 means re-authenticate — guide the user to `openbkn auth login`, do not loop silently.

## Audit

- Operator actions (user/role/model changes) are auditable on the backend; the `audit` surface reads those logs. Treat audit output as sensitive (may contain identifiers).

## Logging rules

- All log messages in English.
- Log intent and outcome, never credentials, raw tokens, or full PII payloads.
- TLS: do not disable verification by default; any insecure toggle must be explicit and env-gated.
