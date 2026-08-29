# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""Managed lifecycle sessions — the thing that makes a read evidence.

Every MCP read wants a `bkn_context` naming the conversation and interaction it
belongs to, so the platform can file the operation against a turn instead of an
anonymous bucket. This module opens one interaction per `session(traced=True)`
scope, reuses it for every read inside, and finishes it on the way out.

One interaction per scope, not per query: opening one per read would cost a
round trip each time and shatter the evidence chain into unrelated turns, which
is the opposite of the point.

The deploy this was built against speaks the contract where
`bkn_start_interaction` alone mints both ids — there is no separate
`bkn_create_conversation` in its catalog — and `bkn_context` accepts only those
two ids.
"""

from __future__ import annotations

import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, TypeVar

from .config import Context
from .errors import BknError, HttpError, ToolError, required_action
from .mcp import call_tool, tool_catalog

__all__ = [
    "Interaction",
    "borrowed_interaction",
    "current_interaction",
    "interaction_scope",
    "with_context_retry",
]

T = TypeVar("T")

START_TOOL = "bkn_start_interaction"
FINISH_TOOL = "bkn_finish_interaction"
#: The other contract in the wild: a conversation is created before an
#: interaction is started inside it.
CREATE_TOOL = "bkn_create_conversation"

DEFAULT_QUESTION = "bkn-osdk read"
#: Display-only attribution, so an SDK-opened turn is identifiable in Trace.
AGENT_NAME = "bkn-osdk"


@dataclass(frozen=True)
class Catalog:
    """What a deploy's tool catalog says about opening a turn.

    Two builds advertise the same tool names and still disagree on the
    arguments: one declares `conversation_mode` required on the start tool, the
    other never published it. Only the tool's own schema separates them, so the
    probe keeps it rather than throwing it away with the names.
    """

    tools: frozenset[str]
    #: True when the start tool declares `conversation_mode`.
    declares_conversation_mode: bool = False


@dataclass
class Interaction:
    """One open turn: the ids every traced read carries."""

    kn_id: str
    conversation_id: str
    interaction_id: str
    #: Receipts collected from the reads made inside this interaction.
    receipts: list[dict[str, Any]] = field(default_factory=list)
    #: True when the caller handed us this turn. Never finish someone else's.
    caller_owned: bool = False

    @property
    def bkn_context(self) -> dict[str, str]:
        """Exactly the two ids. This contract rejects anything else outright."""
        return {
            "conversation_id": self.conversation_id,
            "interaction_id": self.interaction_id,
        }


_current: ContextVar[dict[str, Interaction] | None] = ContextVar(
    "bkn_osdk_interactions", default=None
)
_lock = threading.Lock()
_catalogs: dict[str, Catalog] = {}


def current_interaction(ctx: Context, kn_id: str) -> Interaction:
    """The interaction for this scope and network, opening one if needed.

    Scoped per network: one `session(traced=True)` that reads two networks holds
    two interactions, because an interaction belongs to a knowledge network.
    """
    open_interactions = _current.get()
    if open_interactions is None:
        raise BknError(
            "A traced read needs an open interaction. Wrap the call in "
            "`with bkn_osdk.session(traced=True):`, which opens one and finishes it on exit."
        )
    existing = open_interactions.get(kn_id)
    if existing is not None:
        return existing

    interaction = _start(ctx, kn_id)
    open_interactions[kn_id] = interaction
    return interaction


def interaction_scope() -> ContextVar[dict[str, Interaction] | None]:
    """The scope's registry, so `session()` can open and close one."""
    return _current


def _start(ctx: Context, kn_id: str, question: str = DEFAULT_QUESTION) -> Interaction:
    """Join the caller's turn where there is one; otherwise open our own.

    A host that already owns a business turn — the sandbox injects both ids per
    execution — has something real to bind evidence to, which is worth more than
    anything opened here. Where only a conversation is named, the interaction is
    opened *inside* it rather than in a fresh conversation the caller never
    asked for.
    """
    if ctx.conversation_id and ctx.interaction_id:
        return Interaction(kn_id, ctx.conversation_id, ctx.interaction_id, caller_owned=True)

    catalog = _catalog(ctx)
    tools = catalog.tools
    if START_TOOL not in tools:
        raise BknError(
            f"This deploy's tool catalog has no {START_TOOL}, so no managed interaction can "
            "be opened. Read without `traced=True`; the REST path needs no session."
        )
    if CREATE_TOOL in tools:
        # The older contract mints the conversation separately. Nothing here has
        # been able to test it, so it is refused rather than guessed at.
        raise BknError(
            f"This deploy speaks the {CREATE_TOOL} lifecycle contract, which this runtime "
            "does not implement yet. Read without `traced=True`."
        )

    result = call_tool(
        ctx,
        kn_id,
        START_TOOL,
        {
            "question": question,
            #: Display-only, but the only thing separating a turn this SDK
            #: opened from a real agent's in a Trace listing.
            "agent_name": AGENT_NAME,
            **({"conversation_id": ctx.conversation_id} if ctx.conversation_id else {}),
            # Sent only where the tool declares it: this contract validates
            # strictly, and a deploy may reject an argument it never published.
            # An unreadable catalog answers "no" — send what has always worked
            # rather than guess a new field in.
            **(
                {"conversation_mode": "continue" if ctx.conversation_id else "new"}
                if catalog.declares_conversation_mode
                else {}
            ),
        },
    )
    value = result.value if isinstance(result.value, dict) else {}
    conversation_id = value.get("conversation_id")
    interaction_id = value.get("interaction_id")
    if not isinstance(conversation_id, str) or not isinstance(interaction_id, str):
        raise BknError(f"{START_TOOL} returned no conversation/interaction id: {value}")
    return Interaction(kn_id, conversation_id, interaction_id)


@contextmanager
def borrowed_interaction(ctx: Context, kn_id: str) -> Iterator[Interaction]:
    """An interaction to attach a call to, whoever owns it.

    Inside a `session(traced=True)` scope this is the scope's own turn, so the
    evidence stays together. Outside one, a short-lived turn is opened and
    finished around the call — some tools require a `bkn_context` unconditionally,
    and refusing to run outside a traced scope would make them unusable for no
    gain.
    """
    scope = _current.get()
    if scope is not None:
        yield current_interaction(ctx, kn_id)
        return

    interaction = _start(ctx, kn_id)
    try:
        yield interaction
    finally:
        finish(ctx, interaction, "completed", None)


def with_context_retry(ctx: Context, kn_id: str, send: Callable[[dict[str, str] | None], T]) -> T:
    """Send once bare; if the deploy demands a session, open one and repeat.

    Some deploys enforce the lifecycle contract on the REST surface too, and
    answer `conversation_required` to a request with no `bkn_context`. Rather
    than making every caller pre-open an interaction for a deploy that may not
    want one, the first attempt goes out bare and the requirement is discovered
    from the refusal.

    Inside a `session(traced=True)` scope the scope's own interaction is used, so
    the evidence stays on one turn. Outside one, a short-lived interaction is
    opened and finished around the retry — the read still lands in the chain,
    just on a turn of its own.
    """
    try:
        return send(None)
    except (HttpError, ToolError) as error:
        if not _needs_context(error):
            raise

    with borrowed_interaction(ctx, kn_id) as interaction:
        return send(interaction.bkn_context)


def _needs_context(error: HttpError | ToolError) -> bool:
    """Whether this refusal is the lifecycle middleware asking for a session."""
    if isinstance(error, ToolError):
        return error.code in _LIFECYCLE_ACTIONS or error.required_action in _LIFECYCLE_ACTIONS
    return required_action(error.body) in _LIFECYCLE_ACTIONS


#: What a deploy answers when it wants a `bkn_context`. The two contracts name
#: different actions for the same requirement, so both are recognised.
_LIFECYCLE_ACTIONS = frozenset(
    {"conversation_required", "create_conversation", "start_interaction", START_TOOL}
)


def finish(ctx: Context, interaction: Interaction, outcome: str, answer: str | None) -> None:
    """Close the turn, unless the caller owns it.

    Finishing someone else's interaction would end their business turn early —
    the host that opened it decides when it is done.

    Our own failures are swallowed: the reads already happened and their receipts
    are already recorded, so turning a bookkeeping error into the caller's
    exception would hide the result they came for.
    """
    if interaction.caller_owned:
        return
    try:
        call_tool(
            ctx,
            interaction.kn_id,
            FINISH_TOOL,
            {
                "interaction_id": interaction.interaction_id,
                "outcome": outcome,
                **({"answer": answer} if answer and outcome == "completed" else {}),
            },
        )
    except BknError:
        return


def _catalog(ctx: Context) -> Catalog:
    """The deploy's tool catalog, read once per process per deploy."""
    with _lock:
        cached = _catalogs.get(ctx.base_url)
    if cached is not None:
        return cached

    payload = tool_catalog(ctx)
    entries = payload.get("tools") if isinstance(payload, dict) else None
    tools = [entry for entry in (entries or []) if isinstance(entry, dict)]
    names = frozenset(entry["name"] for entry in tools if isinstance(entry.get("name"), str))
    catalog = Catalog(
        tools=names,
        declares_conversation_mode=any(
            entry.get("name") == START_TOOL and _declares(entry, "conversation_mode")
            for entry in tools
        ),
    )
    with _lock:
        _catalogs[ctx.base_url] = catalog
    return catalog


def _declares(tool: dict[str, Any], field: str) -> bool:
    """Whether a tool's published input schema names this argument.

    Keyed on `properties` rather than `required`: a field the deploy published
    is one it knows, and sending a published-but-optional argument is safe where
    sending an unpublished one is not. The platform is moving the other way
    anyway — a build that listed `conversation_mode` as optional now lists it as
    required.
    """
    schema = tool.get("input_schema") or tool.get("inputSchema")
    if not isinstance(schema, dict):
        return False
    properties = schema.get("properties")
    return isinstance(properties, dict) and field in properties


def _reset_for_tests() -> None:
    with _lock:
        _catalogs.clear()
