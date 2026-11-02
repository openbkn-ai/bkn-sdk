# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""The Q&A web page with sign-in: each person reads and asks with their own permissions.

    pip install fastapi uvicorn
    BKN_KN_ID=ecommerce_ops_bkn_public BKN_CLIENT_ID=<client_id> \\
        python examples/app/qa_web_oauth.py

Then open http://127.0.0.1:8765 — that host exactly, not `localhost`: the
callback is registered there, and the sign-in cookie has to come back to it.

`BKN_CLIENT_ID` is a client registered once for this app, with this callback:

    python -c "from bkn_osdk import oauth, resolve_context as r; \\
        print(oauth.register_client(r().base_url, 'qa-web', insecure=r().insecure))"

The platform is the one the credential chain resolves to (your own
`openbkn auth login`), which also generates the package on first run; after
that, every read and every question carries the signed-in user's token.

Objects are read through the generated package (see `bootstrap.py`): typed
properties, values already converted. The classes carry ids only, so the object
types are named from the platform's listing. `qa_web.py` reads with nothing
generated instead, and with no sign-in.
"""

from __future__ import annotations

import html
import os
import secrets
import sys
import threading
from contextlib import AbstractContextManager
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # so `bootstrap` imports
sys.path.insert(0, str(Path(__file__).resolve().parent))  # and `qa_page`

import httpx
import uvicorn
from bootstrap import kn_id, package
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from qa_page import HOST, PORT, Question, forward, open_agent, page

import bkn_osdk
from bkn_osdk import AuthError, kn, oauth

KN_ID = kn_id()
CLIENT_ID = os.environ.get("BKN_CLIENT_ID", "")
if not CLIENT_ID:
    raise SystemExit("Set BKN_CLIENT_ID to a client registered for this app; see the docstring.")
REDIRECT_URI = f"http://{HOST}:{PORT}/callback"
# The platform the developer is logged in to: where users sign in, and where the
# package below was generated from.
PLATFORM = bkn_osdk.resolve_context()
bkn = package()
CLASSES = {cls.__bkn_id__: cls for cls in bkn.OBJECT_TYPES}

app = FastAPI()
client = httpx.Client(timeout=300, verify=not PLATFORM.insecure)

# Sessions live in memory, so a restart signs everyone out; with several
# instances, keep them in Redis or a database.
pending: dict[str, oauth.AuthorizationRequest] = {}  # signing in: cookie -> request (PKCE)
sessions: dict[str, oauth.Tokens] = {}  # signed in: cookie -> this user's tokens
# One renewal at a time: a refresh_token used twice makes the platform revoke the
# user's whole chain of tokens.
refresh_lock = threading.Lock()


@app.get("/")
def home() -> HTMLResponse:
    return page(sign_out=True)


def signed_in(request: Request) -> oauth.Tokens:
    """This browser's tokens, renewed first when about to expire; 401 when there are none."""
    sid = request.cookies.get("sid", "")
    with refresh_lock:
        tokens = sessions.get(sid)
        if tokens is None:
            raise HTTPException(status_code=401)
        if tokens.expires_within(60):
            # Every renewal issues a new refresh_token; keep the new set.
            try:
                tokens = oauth.refresh(
                    PLATFORM.base_url, tokens, client_id=CLIENT_ID, insecure=PLATFORM.insecure
                )
            except AuthError:
                sessions.pop(sid, None)
                raise HTTPException(status_code=401) from None
            sessions[sid] = tokens
        return tokens


def as_user(request: Request) -> AbstractContextManager[bkn_osdk.Context]:
    """Read as this user: each person sees what their own permissions allow."""
    return bkn_osdk.session(base_url=PLATFORM.base_url, token=signed_in(request).access_token)


@app.get("/api/object-types")
def object_types(request: Request) -> list[dict[str, str]]:
    """The generated classes this user can see, named as the platform names them."""
    with as_user(request):
        listing = kn.get_object_types(KN_ID, limit=200)
    return [
        {"id": item["id"], "name": item.get("name") or item["id"]}
        for item in listing["object_types"]
        if item["id"] in CLASSES and item.get("data_source")
    ]


@app.get("/api/objects/{type_id}")
def objects(request: Request, type_id: str) -> dict[str, Any]:
    """The first 10 rows and the total, read through the generated class: typed values."""
    cls = CLASSES[type_id]
    props = cls.__properties__()
    with as_user(request):
        found, total = cls.take(10), cls.count()
    rows = [{prop.bkn_id: getattr(row, prop.attribute) for prop in props} for row in found]
    return {"rows": rows, "total": total}


@app.post("/ask")
def ask(request: Request, q: Question) -> Response:
    token = signed_in(request).access_token
    return forward(open_agent(client, PLATFORM.base_url, token, KN_ID, q))


@app.get("/login")
def login() -> RedirectResponse:
    # Make PKCE and state, remember them for this browser, then send it to sign in.
    auth = oauth.authorization_request(PLATFORM.base_url, CLIENT_ID, REDIRECT_URI)
    sid = secrets.token_urlsafe(32)
    pending[sid] = auth
    response = RedirectResponse(auth.url)
    response.set_cookie("sid", sid, httponly=True, samesite="lax")
    return response


@app.get("/callback", response_model=None)
def callback(
    request: Request, code: str = "", state: str = "", error: str = ""
) -> HTMLResponse | RedirectResponse:
    sid = request.cookies.get("sid", "")
    auth = pending.pop(sid, None)
    try:
        if error or auth is None:
            raise AuthError(error or "no sign-in in progress")
        # Check state, then exchange the code for this user's tokens.
        sessions[sid] = oauth.exchange_code(
            PLATFORM.base_url, auth, code, state, insecure=PLATFORM.insecure
        )
    except AuthError as failure:
        reason = html.escape(str(failure))
        return HTMLResponse(f'Sign-in did not finish: {reason} <a href="/login">Sign in again</a>')
    return RedirectResponse("/")


@app.get("/logout")
def logout(request: Request) -> RedirectResponse:
    sessions.pop(request.cookies.get("sid", ""), None)
    response = RedirectResponse("/")
    response.delete_cookie("sid")
    return response


if __name__ == "__main__":
    uvicorn.run(app, host=HOST, port=PORT)
