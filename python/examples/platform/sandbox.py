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
INFER = "/api/agent-operator-integration/v1/function/infer-schema"
#: Pin a commit. A branch name is a moving target, and pip's wheel cache is
#: keyed by URL, so a rebuild can silently reinstall the build it already had.
SPEC = "bkn-osdk @ https://github.com/openbkn-ai/bkn-sdk/archive/{sha}.zip#subdirectory=python"

#: The same work as a *tool* rather than a script. `@tool` comes from
#: `sandbox_sdk`, already on the sandbox's path, and it makes the signature the
#: single source of truth: `/function/infer-schema` runs the code and reads back
#: the contract, so nobody retypes the parameters into a form. A function
#: published into a toolbox is this, with a name.
TOOL = '''
from sandbox_sdk import tool


@tool
def rows_of(kn_id: str, object_type: str, limit: int = 10) -> dict:
    """Count rows of one object type in a knowledge network."""
    from bkn_osdk import kn

    answer = kn.query_object_instance(kn_id, object_type, limit=limit, response_format="json")
    return {"rows": len(answer.get("datas") or [])}
'''

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

INSTALL = r"""
import subprocess, sys

def handler(event):
    done = subprocess.run(
        [sys.executable, "-m", "pip", "install", "-q", "--no-deps", event["spec"]],
        capture_output=True, text=True,
    )
    # pip retries a flaky network on its own, so a non-empty stderr with a zero
    # return code means "it worked, eventually" — worth distinguishing from a
    # failure, and from the upgrade notice pip prints even on a clean install.
    noise = ("notice", "A new release of pip")
    lines = [
        line
        for line in done.stderr.splitlines()
        if line.strip() and not any(word in line for word in noise)
    ]
    return {
        "ok": done.returncode == 0,
        **({"retried": lines[-1][-120:]} if done.returncode == 0 and lines else {}),
        **({"error": "\n".join(lines[-4:])} if done.returncode else {}),
    }
"""


def run(scoped: bkn_osdk.Context, turn: object, code: str, event: dict, label: str = "") -> dict:
    """One sandbox execution, carrying this process's turn into it.

    The code is printed before it goes, because that is the thing worth seeing:
    everything above this line runs here, everything inside that block runs on
    the platform, and the only join between them is `event` and the two ids.
    """
    print(f"\n--- {label or 'sending'} ------------------------------------")
    for line in code.strip().splitlines():
        print(f"  | {line}")
    print(f"  event: {event}")
    print("  " + "-" * 46)

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
    # A commit that exists on GitHub: the sandbox installs from the archive URL,
    # so an unpushed local sha would 404 there. Override with `BKN_OSDK_SHA`.
    sha = os.environ.get("BKN_OSDK_SHA", "7a23935")
    with bkn_osdk.session(traced=True) as scoped:
        turn = current_interaction(scoped, kn_id())
        print(f"host turn {turn.interaction_id}")

        # Two calls, not one: installing and working in the same execution runs
        # long enough to hit the gateway's timeout. The install lands in
        # `/workspace/.local/...` and a later execution (a fresh process) sees it.
        installed = run(scoped, turn, INSTALL, {"spec": SPEC.format(sha=sha)}, "install")
        # A repeat execution in a pooled session sometimes answers `exit_code: 0`
        # with `result: null` — the handler's return value is dropped on the way
        # back. Saying so beats guessing "already installed", which is what this
        # printed before and was not what happened.
        print(f"install: {installed or '(exit 0, but the sandbox returned no result)'}")
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
                "generate and read, inside",
            )
        )

        # The same code as a tool contract. This *executes* it — the signature is
        # read back from what the decorator registered rather than parsed — so it
        # needs the same rights as running anything else here. Code without
        # `@tool` is not an error: the answer is 200 with `supported: false`, and
        # the caller fills the contract in by hand instead.
        print("\n--- infer-schema ------------------------------------")
        for line in TOOL.strip().splitlines():
            print(f"  | {line}")
        print("  " + "-" * 46)
        contract = request(scoped, INFER, body={"code": TOOL}, timeout=280)
        print(f"supported: {contract.get('supported')} | name: {contract.get('name')}")
        print(f"  description: {contract.get('description')}")
        for argument in contract.get("inputs") or []:
            print(f"  in  {argument}")
        for result in contract.get("outputs") or []:
            print(f"  out {result}")


if __name__ == "__main__":
    main()
