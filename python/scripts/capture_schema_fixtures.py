# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""Record a live network's schema responses as generator fixtures.

The generator is tested against real wire data, not against a hand-written idea
of it, so the fixtures are captured rather than authored::

    openbkn auth login                      # this script never writes a token
    python scripts/capture_schema_fixtures.py ecommerce_ops_bkn_public

Credentials resolve through the runtime's own chain, so whatever `openbkn` is
logged into is what gets recorded. Re-run it when the platform's response shape
changes; the diff is then a reviewable record of that change.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from bkn_osdk import http, resolve_context

FIXTURE_DIR = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "schema"
ONTOLOGY_BASE = "/api/ontology-manager/v1/knowledge-networks"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kn_id", help="knowledge network id to record")
    parser.add_argument("--branch", default="main")
    parser.add_argument("--out", type=Path, default=FIXTURE_DIR)
    args = parser.parse_args(argv)

    ctx = resolve_context()
    base = f"{ONTOLOGY_BASE}/{args.kn_id}"
    schema_query = {"branch": args.branch, "limit": -1}
    targets = [
        ("network", base, None),
        ("object_types", f"{base}/object-types", schema_query),
        ("relation_types", f"{base}/relation-types", schema_query),
    ]

    # Fetch everything before writing anything: a half-recorded fixture set would
    # fail later as a missing type rather than as the auth error it really is.
    recorded = [(name, http.request(ctx, path, query=query)) for name, path, query in targets]

    out: Path = args.out / args.kn_id
    out.mkdir(parents=True, exist_ok=True)
    for name, payload in recorded:
        target = out / f"{name}.json"
        target.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        print(f"{target.relative_to(Path.cwd())}: {target.stat().st_size} bytes", file=sys.stderr)

    print(f"captured from {ctx.base_url}, branch {args.branch}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
