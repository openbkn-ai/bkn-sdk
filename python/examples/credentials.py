# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""Where the platform address and the token come from.

    python examples/credentials.py

Four levels, innermost first: a `session(...)` scope, then `configure(...)`, then
`BKN_BASE_URL` / `BKN_TOKEN`, then the store `openbkn auth login` writes. Each
field falls through on its own, so naming a token in a scope does not mean
repeating the platform.

The usual setup is one command, and then nothing in the code at all:

    openbkn auth login --base-url https://14.103.77.23 -u admin -p '…' -k

`-k` is for the self-signed certificate an IP deploy serves; it is remembered
per platform, so it need not be repeated. That login is also the only source
with a refresh token — an access token from the environment or an AppKey cannot
be renewed when it expires, while a stored session is refreshed in place.

Nothing here prints a whole token.
"""

from __future__ import annotations

import os

import bkn_osdk
from bkn_osdk import Context


def describe(label: str, ctx: Context) -> None:
    """One line per level. A real token is shown by its first characters only."""
    source = "store, 可刷新" if ctx.credential else "显式给的, 不可刷新"
    token = ctx.token if ctx.token.startswith("token-from-") else f"{ctx.token[:10]}…"
    print(f"{label:14} {ctx.base_url:24} token={token:22} 来自 {source}")


def main() -> None:
    # 1. Nothing named at all: the store answers, including the TLS opt-out that
    #    `openbkn auth login -k` recorded for this platform.
    try:
        describe("默认", bkn_osdk.resolve_context())
    except bkn_osdk.InputError as error:
        raise SystemExit(f"没有可用凭据: {error}") from None

    # 2. The environment beats the store. `BKN_USER` picks one of several saved
    #    identities for the same platform rather than the active one — and note
    #    what a token from here costs: no refresh, because there is no session
    #    behind it to refresh.
    os.environ["BKN_TOKEN"] = "token-from-env"
    describe("环境变量", bkn_osdk.resolve_context())
    del os.environ["BKN_TOKEN"]

    # 3. `configure` sets the process default, and *replaces* it rather than
    #    merging — `configure()` with no arguments clears it.
    stored = bkn_osdk.resolve_context()
    bkn_osdk.configure(base_url=stored.base_url, token="token-from-configure", insecure=True)
    describe("configure", bkn_osdk.resolve_context())

    # 4. A scope wins over all of it, and only for its own body. Fields left
    #    unset keep falling through — this one names a token and inherits the
    #    platform from the level above.
    with bkn_osdk.session(token="token-from-session") as scoped:
        describe("session 内", scoped)
    describe("session 退出后", bkn_osdk.resolve_context())

    bkn_osdk.configure()  # clear the process default again
    describe("清空之后", bkn_osdk.resolve_context())

    # The turn is resolved the same way, and the sandbox names it in the
    # environment so code running there joins the caller's turn with no argument
    # passing. See examples/platform/sandbox.py.
    live = bkn_osdk.resolve_context()
    print(
        f"\n业务域 {live.business_domain} | "
        f"环境里的 turn {live.conversation_id or '(无)'} / {live.interaction_id or '(无)'}"
    )

    # The CLI takes the same four fields as flags, and applies them as a
    # `session(...)` scope — so the command line and the library agree on
    # precedence rather than each having its own:
    #
    #   bkn-osdk generate <kn-id> --out ./bkn \
    #       --base-url https://14.103.77.23 --token-file /run/secrets/bkn --insecure
    #
    # `--token` would be visible in `ps` and in shell history; `--token-file`
    # reads a mounted secret, or stdin when given as `-`.


if __name__ == "__main__":
    main()
