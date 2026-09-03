# Server version check design

## Goal

On an unstable `0.x` platform, do not send SDK business requests to a platform
whose release version differs from the SDK's `major.minor.patch` version.

## Source of truth

The BKN backend's public `GET /api/bkn-backend/v1/health` endpoint exposes `ServerVersion`. The
current release process gives every service the same version, so the SDK treats
that value as the platform version. This is deliberately separate from any
future independent service-version scheme.

## Compatibility rule

Both values must be valid SemVer strings (an optional leading `v` is accepted).
Prerelease and build metadata are ignored, then `major.minor.patch` must match
exactly. Thus SDK `0.1.5-rc.1` is compatible with server `0.1.5`; SDK `0.1.4`
is not compatible with server `0.1.5`.

## Request behavior

`createClient()` remains synchronous and has no network side effects. The
shared HTTP request layer performs a lazy preflight before the first business
request. The check calls `GET <baseUrl>/api/bkn-backend/v1/health`, parses `ServerVersion`, and
only then sends the requested API call. The health request itself is exempt to
avoid recursion. Absolute URLs are supported only when they have the same origin
as `baseUrl`; a request cannot apply one platform's successful check or credentials
to another platform.

A programmatic client stores its successful check in memory for its lifetime.
The CLI persists a successful result per normalized base URL for 60 seconds so
separate command processes do not repeatedly probe health. Failed checks are
never cached. Dry runs make no health request because they must not send any
network traffic.

## Failures

A mismatched, missing, invalid, or unreachable server version blocks the
business request. Errors state the SDK version, server version when known, and
the action to take. The behavior is intentionally fail-closed for `0.x`.

## Scope and boundaries

The check lives in the API layer, not individual commands or resources. Raw
`call()` follows the same rule, except for the version endpoint itself and with
the same-origin restriction for absolute URLs. CLI-only persistent
caching stays in the config store; library callers receive no filesystem side
effects.
