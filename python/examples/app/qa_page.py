# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""What the two Q&A apps share: the page, and asking the Agent.

The page is static. Its script draws everything from the app's JSON routes —
`/api/object-types`, `/api/objects/{id}` — and reads the Agent's own event
stream from `/ask`, so the apps answer with data and build no HTML. They differ
only in whose token they use and how they read objects.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator

import httpx
from fastapi.responses import HTMLResponse, Response, StreamingResponse
from pydantic import BaseModel

AGENT_ID = "studio_smart_qa"  # the platform's preset Q&A agent
HOST, PORT = "127.0.0.1", 8765

# Tailwind from its CDN keeps the sample one file; build the CSS the Tailwind way
# in production. Answers are Markdown, rendered by marked and sanitized by
# DOMPurify; everything else is written as text, never as markup. The one style
# rule keeps hidden elements hidden, where Tailwind classes such as `grid` would
# show them.
PAGE = r"""<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Knowledge network Q&amp;A</title>
<script src="https://cdn.tailwindcss.com/3.4.16?plugins=typography"></script>
<style>[hidden] { display: none !important; }</style>
<body class="min-h-screen bg-slate-50 text-slate-800">
<main class="mx-auto max-w-6xl space-y-6 px-4 py-10">
<h1 class="text-2xl font-semibold tracking-tight">Knowledge network Q&amp;A</h1>
<section id="signin" hidden class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
  <p class="mb-4 text-slate-500">Sign in with your platform account to see the data and ask.</p>
  <a href="/login" class="rounded-xl bg-blue-600 px-5 py-2 font-medium text-white
    hover:bg-blue-700">Sign in with OpenBKN</a>
</section>
<div id="app" hidden class="grid gap-6 md:grid-cols-[13rem_minmax(0,1fr)]">
  <aside class="self-start rounded-2xl border border-slate-200 bg-white p-2 shadow-sm
    md:sticky md:top-6">
    <h2 class="mb-2 px-3 text-xs font-medium text-slate-400">Object types</h2>
    <nav id="types" class="space-y-0.5"></nav>
  </aside>
  <div class="min-w-0 space-y-6">
    <section id="objects" class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    </section>
    <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div class="mb-4 flex items-center justify-between">
        <h2 class="font-medium">Q&amp;A</h2>
        <nav class="flex gap-4 text-sm text-slate-500">
          <a href="#" id="reset" class="hover:text-blue-600">New chat</a>
          <a href="/logout" id="logout" hidden class="hover:text-blue-600">Sign out</a>
        </nav>
      </div>
      <div id="log" class="space-y-4"></div>
      <form id="ask" class="mt-5 flex gap-2">
        <input id="question" placeholder="Ask about this network" autocomplete="off" required
          class="flex-1 rounded-xl border border-slate-300 px-4 py-2 focus:border-blue-500
          focus:outline-none focus:ring-2 focus:ring-blue-100">
        <button class="rounded-xl bg-blue-600 px-5 py-2 font-medium text-white
          hover:bg-blue-700">Ask</button>
      </form>
    </section>
  </div>
</div>
</main>
<script src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js"></script>
<script>
const $ = (id) => document.getElementById(id);
const add = (parent, tag, className, text = "") => {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  parent.append(element);
  return element;
};
// A 401 means nobody is signed in, or the token stopped working.
const signedOut = () => {
  $("app").hidden = true;
  $("signin").hidden = false;
};
async function load(url) {
  const response = await fetch(url);
  if (response.status === 401) return signedOut();
  if (!response.ok) throw new Error("Could not read: " + response.status);
  return response.json();
}
const CELL = "whitespace-nowrap border-b border-slate-100 px-3 py-2";
async function showObjects(type, link) {
  for (const other of $("types").children) other.removeAttribute("aria-current");
  link.setAttribute("aria-current", "page");
  const box = $("objects");
  try {
    const data = await load("/api/objects/" + encodeURIComponent(type.id));
    if (!data) return;
    // Platform keys (`_instance_id` and the like) start with an underscore.
    const columns = Object.keys(data.rows[0] ?? {}).filter((key) => !key.startsWith("_")).sort();
    box.replaceChildren();
    const title = add(box, "h2", "mb-3 font-medium", type.name + " ");
    add(title, "span", "text-sm font-normal text-slate-400", data.rows.length + " / " + data.total);
    const table = add(add(box, "div", "overflow-x-auto"), "table", "min-w-full text-sm");
    const head = add(add(table, "thead", ""), "tr", "");
    for (const column of columns) {
      add(head, "th", CELL + " text-left font-medium text-slate-500", column);
    }
    const body = add(table, "tbody", "");
    for (const row of data.rows) {
      const line = add(body, "tr", "");
      for (const column of columns) add(line, "td", CELL, row[column] ?? "");
    }
  } catch (failure) {
    box.replaceChildren();
    add(box, "p", "text-red-600", failure.message);
  }
}
async function start() {
  const types = await load("/api/object-types");
  if (!types) return;
  for (const type of types) {
    const link = add($("types"), "button", "block w-full truncate rounded-lg px-3 py-1.5 "
      + "text-left text-sm text-slate-600 hover:bg-slate-100 aria-[current=page]:bg-blue-50 "
      + "aria-[current=page]:font-medium aria-[current=page]:text-blue-700", type.name);
    link.onclick = () => showObjects(type, link);
  }
  $("types").firstChild?.click();
  $("app").hidden = false;
}
let thread = null;
const show = (element, markdown) => {
  element.innerHTML = DOMPurify.sanitize(marked.parse(markdown));
};
$("reset").onclick = (event) => {
  event.preventDefault();
  thread = null;
  $("log").replaceChildren();
};
// The Agent's events, each an `event:` and a `data:` line, a blank line apart:
// `meta` carries the thread, `tool_started` what it looked up, `token` the
// answer as it is written (text before a tool call is progress, so it is
// dropped), `result` the final answer.
$("ask").onsubmit = async (event) => {
  event.preventDefault();
  const question = $("question").value.trim();
  if (!question) return;
  $("question").value = "";
  add($("log"), "div", "ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-blue-600 "
    + "px-4 py-2 text-white", question);
  const turn = add($("log"), "div", "max-w-[85%] space-y-1");
  const steps = add(turn, "div", "text-xs text-slate-400");
  const answer = add(turn, "div", "prose prose-sm prose-slate max-w-none rounded-2xl "
    + "rounded-bl-sm bg-slate-100 px-4 py-2", "Thinking…");
  answer.scrollIntoView({ block: "end", behavior: "smooth" });
  const response = await fetch("/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, thread_id: thread }),
  });
  if (response.status === 401) return signedOut();
  if (!response.ok) {
    answer.textContent = "Request failed: " + response.status;
    return;
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let written = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const events = buffer.split("\n\n");
    buffer = events.pop();
    for (const event of events) {
      const name = event.match(/^event: (.*)$/m)?.[1];
      const data = JSON.parse(event.match(/^data: (.*)$/m)?.[1] ?? "{}");
      if (name === "meta") thread = data.thread_id;
      if (name === "tool_started") {
        steps.textContent += (steps.textContent ? " → " : "Looked up: ") + data.name;
        written = "";
        answer.textContent = "Thinking…";
      }
      if (name === "token") show(answer, (written += data.content));
      if (name === "result") show(answer, data.content.answer);
      if (name === "terminal" && data.status !== "succeeded") {
        answer.textContent = "No answer. " + (data.error?.detail ?? "");
      }
    }
  }
};
start();
</script>
"""


def page(sign_out: bool = False) -> HTMLResponse:
    """The page; the app with sign-in also offers a way out."""
    return HTMLResponse(PAGE.replace('id="logout" hidden', 'id="logout"') if sign_out else PAGE)


class Question(BaseModel):
    question: str
    thread_id: str | None = None


def open_agent(
    client: httpx.Client, base_url: str, token: str, kn_id: str, q: Question
) -> httpx.Response:
    """Start one Agent turn on this network; its answer streams back as server-sent events."""
    body: dict[str, object] = {
        "agent_id": AGENT_ID,
        "message": q.question,
        "client_request_id": str(uuid.uuid4()),
        "context": {"kn_id": kn_id},
    }
    if q.thread_id:
        body["thread_id"] = q.thread_id  # continue the previous turn: a multi-turn chat
    request = client.build_request(
        "POST",
        f"{base_url.rstrip('/')}/api/bkn-agent/v1/executions",
        json=body,
        headers={"Authorization": f"Bearer {token}"},
    )
    return client.send(request, stream=True)


def forward(upstream: httpx.Response) -> Response:
    """The Agent's event stream, handed to the page untouched; its status if it failed."""
    if upstream.is_error:
        upstream.close()
        return Response(status_code=upstream.status_code)

    def events() -> Iterator[bytes]:
        try:
            yield from upstream.iter_raw()
        finally:
            upstream.close()

    return StreamingResponse(events(), media_type="text/event-stream")
