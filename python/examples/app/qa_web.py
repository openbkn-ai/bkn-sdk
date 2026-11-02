# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""A Q&A web page over one network, with nothing generated and nobody signing in.

    pip install fastapi uvicorn
    BKN_KN_ID=ecommerce_ops_bkn_public python examples/app/qa_web.py

Then open http://127.0.0.1:8765. The side list holds the network's object types;
picking one shows its first rows; below, the platform's Q&A agent answers over
several turns, streaming as it writes and naming the tools it used.

Every visitor reads and asks as one identity — whatever the credential chain
resolves to: the `openbkn auth login` store, or `BKN_BASE_URL` with `BKN_TOKEN`
(an API key, for a team's internal tool). To have each person sign in and read
with their own permissions, see `qa_web_oauth.py`.

No package is generated: the platform layer lists the object types and reads
their rows, so the page keeps working when the network changes, at the cost of
untyped values. `qa_web_oauth.py` reads through the generated package instead.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # so `bootstrap` imports
sys.path.insert(0, str(Path(__file__).resolve().parent))  # and `qa_page`

import httpx
import uvicorn
from bootstrap import kn_id
from fastapi import FastAPI
from fastapi.responses import HTMLResponse, Response
from qa_page import HOST, PORT, Question, forward, open_agent, page

import bkn_osdk
from bkn_osdk import kn

KN_ID = kn_id()
app = FastAPI()
# The self-signed-certificate opt-out comes from the same chain as the token:
# `openbkn -k auth login` remembers it per platform.
client = httpx.Client(timeout=300, verify=not bkn_osdk.resolve_context().insecure)


@app.get("/")
def home() -> HTMLResponse:
    return page()


@app.get("/api/object-types")
def object_types() -> list[dict[str, str]]:
    """The object types with data behind them."""
    listing = kn.get_object_types(KN_ID, limit=200)
    return [
        {"id": item["id"], "name": item.get("name") or item["id"]}
        for item in listing["object_types"]
        if item.get("data_source")
    ]


@app.get("/api/objects/{type_id}")
def objects(type_id: str) -> dict[str, Any]:
    """The first 10 rows and the total, handed to the page as they come."""
    result = kn.query_object_instance(KN_ID, type_id, limit=10)
    return {"rows": result["datas"], "total": result["total_count"]}


@app.post("/ask")
def ask(q: Question) -> Response:
    # Resolved per question, so a stored login that renewed itself is picked up.
    context = bkn_osdk.resolve_context()
    return forward(open_agent(client, context.base_url, context.token, KN_ID, q))


if __name__ == "__main__":
    uvicorn.run(app, host=HOST, port=PORT)
