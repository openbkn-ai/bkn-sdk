# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""Freeze foundry's context-loader OpenAPI as the contract this SDK generates from.

    python scripts/capture_kn_contract.py ../../bkn-foundry/docs/api/context-loader

The specs live in another repository and are YAML; a runtime that parsed them
would need a YAML dependency and a copy of foundry checked out. So they are
normalised once, here, into `contracts/kn-rest.json` — flat, resolved, and
committed — and the generator is a pure function of that file.

Only what generation needs is kept: which routes exist, what each takes in the
query string versus the body, which arguments are required, and the prose that
becomes a docstring. Schemas are resolved one level: a `$ref` to
`components/schemas` is replaced by that schema's own properties, which is as
deep as a signature goes.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import yaml

#: The lifecycle context is attached by the runtime, never by a caller, so it
#: must not become a parameter of a generated function.
MANAGED = "bkn_context"

#: `kn_search` is documented in the spec itself as a compatibility shell for
#: callers that already exist ("兼容壳" / "仅存量调用方"). Generating it would hand new code a
#: front door onto a route the platform is retiring, so it stays reachable
#: through `call` and out of the generated surface.
RETIRED = {"kn_search"}


def resolve(schema: Any, spec: dict[str, Any], section: str = "schemas") -> dict[str, Any]:
    """A node with its top-level `$ref` followed, or itself if there is none.

    Parameters are `$ref`-ed as often as schemas are — `ResponseFormat` is shared
    by half these routes — and a capture that follows only schema refs silently
    drops those arguments from the generated signature. That is invisible until
    a caller passes one and Python refuses the keyword.
    """
    if not isinstance(schema, dict):
        return {}
    reference = schema.get("$ref")
    if isinstance(reference, str) and reference.startswith(f"#/components/{section}/"):
        name = reference.rsplit("/", 1)[-1]
        return dict(((spec.get("components") or {}).get(section) or {}).get(name) or {})
    return dict(schema)


def field(name: str, schema: dict[str, Any], required: bool) -> dict[str, Any]:
    """One argument, as the generator needs to see it."""
    return {
        "name": name,
        "type": schema.get("type", "any"),
        "required": required,
        "description": " ".join(str(schema.get("description", "")).split())[:400],
        **({"enum": schema["enum"]} if isinstance(schema.get("enum"), list) else {}),
    }


def operation(path: str, method: str, op: dict[str, Any], spec: dict[str, Any]) -> dict[str, Any]:
    parameters = [resolve(p, spec, "parameters") for p in (op.get("parameters") or [])]
    query = [
        field(
            parameter["name"],
            resolve(parameter.get("schema") or {}, spec),
            bool(parameter.get("required")),
        )
        for parameter in parameters
        if parameter.get("in") == "query" and parameter.get("name")
    ]

    content = ((op.get("requestBody") or {}).get("content") or {}).get("application/json") or {}
    body_schema = resolve(content.get("schema") or {}, spec)
    required = set(body_schema.get("required") or [])
    body = [
        field(name, resolve(schema, spec), name in required)
        for name, schema in (body_schema.get("properties") or {}).items()
        if name != MANAGED
    ]

    answers = ((op.get("responses") or {}).get("200") or {}).get("content") or {}
    response = resolve((answers.get("application/json") or {}).get("schema") or {}, spec)

    return {
        "path": path,
        "method": method.upper(),
        "operation": path.rsplit("/", 1)[-1],
        "summary": " ".join(str(op.get("summary", "")).split()),
        "description": " ".join(str(op.get("description", "")).split())[:600],
        "query": query,
        "body": body,
        # Every route on this surface refuses a context-free call — measured on
        # both deploys, including three whose request schema does not declare
        # `bkn_context` at all. So the turn is always attached, and the spec is
        # only asked *where* it goes, not whether it is needed.
        "declares_context": MANAGED in (body_schema.get("properties") or {}),
        "returns": sorted((response.get("properties") or {}).keys()),
    }


def capture(directory: Path) -> dict[str, Any]:
    operations: list[dict[str, Any]] = []
    for source in sorted(directory.glob("*.yaml")):
        spec = yaml.safe_load(source.read_text(encoding="utf-8"))
        base = ((spec.get("servers") or [{}])[0]).get("url", "")
        for path, methods in (spec.get("paths") or {}).items():
            if not path.startswith("/kn/"):
                continue  # `/mcp` is the JSON-RPC transport, not a capability route
            if path.rsplit("/", 1)[-1] in RETIRED:
                continue
            for method, op in methods.items():
                if method not in ("get", "post", "put", "delete"):
                    continue
                entry = operation(f"{base}{path}", method, op, spec)
                entry["source"] = source.name
                operations.append(entry)
    operations.sort(key=lambda entry: entry["operation"])
    return {"operations": operations}


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    contract = capture(Path(argv[1]))
    out = Path(__file__).parent.parent / "contracts" / "kn-rest.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(contract, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{len(contract['operations'])} routes -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
