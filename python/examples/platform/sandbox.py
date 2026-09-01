# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""Running the OSDK inside the platform's sandbox, on the caller's own turn.

    BKN_KN_ID=ecommerce_ops_bkn_public BKN_OBJECT_TYPE=order python examples/platform/sandbox.py

The sandbox executes a `handler(event)` and hands back what it returns. What
makes this more than "run some code" is the last two body fields: pass the
conversation and interaction ids and they arrive as environment variables inside,
so the SDK running in there inherits the caller's turn with no argument passing
and the reads land on one chain rather than two.

Measured on both deploys: `BKN_TOKEN`, `BKN_CONVERSATION_ID`, `BKN_INTERACTION_ID`
and `user_id` are present inside; `BKN_BASE_URL` is **not**, and there is no
`~/.bkn` store in there either — so the code that runs inside is the one place
that has to name its platform, which it does with `configure(base_url=…)`.
Everything else it needs arrives in the environment. The image has `pip` and
`httpx` but no `git`, which is why the install below uses the archive URL rather
than `git+https://`.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # so `bootstrap` imports

from bootstrap import kn_id

import bkn_osdk
from bkn_osdk.http import request
from bkn_osdk.lifecycle import current_interaction

EXECUTE = "/api/agent-operator-integration/v1/function/execute"
#: Pin a commit. A branch name is a moving target, and pip's wheel cache is
#: keyed by URL, so a rebuild can silently reinstall the build it already had.
SPEC = "bkn-osdk @ https://github.com/openbkn-ai/bkn-sdk/archive/{sha}.zip#subdirectory=python"

INSIDE = """
import os

def handler(event):
    import bkn_osdk
    from bkn_osdk.codegen.emit import GenOptions, generate
    from bkn_osdk.schema import fetch_schema

    # The token and the turn came in through the environment; only the platform
    # address has to be named.
    bkn_osdk.configure(base_url=event["base_url"], insecure=True)
    ctx = bkn_osdk.resolve_context()

    schema = fetch_schema(ctx, event["kn_id"])
    os.makedirs("/workspace/pkg/bkn", exist_ok=True)
    for name, content in generate(schema, GenOptions(package="bkn")).items():
        open("/workspace/pkg/bkn/" + name, "w", encoding="utf-8").write(content)
    import sys
    sys.path.insert(0, "/workspace/pkg")
    import bkn

    wanted = event["object_type"]
    cls = next(
        (c for c in bkn.OBJECT_TYPES if c.__bkn_id__ == wanted), bkn.OBJECT_TYPES[0]
    )
    return {
        "object types": len(schema.object_types),
        "read through": cls.__bkn_id__,
        "count()": cls.count(),
        "turn inherited": ctx.interaction_id,
    }
"""

INSTALL = """
import subprocess, sys

def handler(event):
    done = subprocess.run(
        [sys.executable, "-m", "pip", "install", "-q", "--no-deps", event["spec"]],
        capture_output=True, text=True,
    )
    return {"rc": done.returncode, "err": done.stderr[-200:]}
"""


def run(scoped: bkn_osdk.Context, turn: object, code: str, event: dict) -> dict:
    """One sandbox execution, carrying this process's turn into it."""
    answer = request(
        scoped,
        EXECUTE,
        body={
            "code": code,
            "event": event,
            "bkn_token": scoped.token,
            "bkn_conversation_id": turn.conversation_id,  # type: ignore[attr-defined]
            "bkn_interaction_id": turn.interaction_id,  # type: ignore[attr-defined]
        },
        timeout=280,
    )
    if answer.get("exit_code"):
        raise SystemExit(f"sandbox execution failed: {str(answer.get('stderr'))[:300]}")
    return answer.get("result") or {}


def main() -> None:
    sha = os.environ.get("BKN_OSDK_SHA", "f044c2e")
    with bkn_osdk.session(traced=True) as scoped:
        turn = current_interaction(scoped, kn_id())
        print(f"host turn {turn.interaction_id}")

        # Two calls, not one: installing and working in the same execution runs
        # long enough to hit the gateway's timeout. The install lands in
        # `/workspace/.local/...` and a later execution (a fresh process) sees it.
        installed = run(scoped, turn, INSTALL, {"spec": SPEC.format(sha=sha)})
        print(f"install: {installed or '(already present in this sandbox session)'}")
        print(
            run(
                scoped,
                turn,
                INSIDE,
                {
                    "base_url": scoped.base_url,
                    "kn_id": kn_id(),
                    "object_type": os.environ.get("BKN_OBJECT_TYPE", ""),
                },
            )
        )


if __name__ == "__main__":
    main()
