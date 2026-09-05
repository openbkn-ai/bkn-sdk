# bkn-osdk

*[中文版](README.zh.md)*

A Python SDK for BKN, in two layers.

**The ontology layer** is typed, read-only, and specific to **one** knowledge
network — generated from that network's schema, the way Palantir's OSDK is:

```python
from bkn.object_types import People

People.where(People.age > 30).take(10)
```

**The platform layer** addresses the platform itself: any REST route by path,
and any tool the deploy publishes by name.

```python
bkn_osdk.call("/api/agent-observability/v1/traces", query={"limit": 10})
bkn_osdk.call_tool(ctx, kn_id, "describe_resource", {"resource_id": "…", ...})
```

The layers are named for what they address, not for how they were built — one
happens to be generated and the other hand-written, which is an implementation
fact rather than something a caller reasons about. Both go through the same
credentials, the same transports, and the same managed turn, so dropping to the
platform layer for one call and coming back up keeps the evidence on one chain.

This is not a port of the TypeScript SDK. That one wraps eleven backend
namespaces in HTTP calls, which buys a Python caller nothing that
`bkn_osdk.call("/api/…")` does not. Generated classes over an ontology cannot be
replaced by a raw call, which is why they are worth a second language.

**Targets platform 0.1.5.** Payloads are taken as the platform sends them, and
the 0.1.4 line does not send the same ones — it wraps `get_kn_detail`,
`list_resources`, `list_skills`, `get_object_types` and `list_knowledge_networks`
in a `result` key, and serves a `semantic-search` route that 0.1.5 withdrew.
Reading against an older deploy is possible but is the caller's own adaptation,
not this SDK's.

## Install

Not on PyPI. The package lives in a subdirectory of this repository, which pip
addresses directly:

```bash
pip install "bkn-osdk @ git+https://github.com/openbkn-ai/bkn-sdk@<sha>#subdirectory=python"
```

Its only dependency is `httpx`, so an image build is one line:

```dockerfile
RUN pip install --no-cache-dir \
    "bkn-osdk @ git+https://github.com/openbkn-ai/bkn-sdk@<sha>#subdirectory=python"
```

**Pin a commit, not a branch.** A direct URL carries no index, so nothing
resolves a "latest" for you and moving versions means editing that line —
which is the point. A branch name looks like it saves that edit and does not:
pip's wheel cache is keyed by URL, so a rebuild against the same branch can
reinstall the build it already has, reporting success while installing the old
commit. `direct_url.json` in the installed distribution records which commit
actually landed.

Where git is not installed — the sandbox image is one such place — the archive
URL takes the same fragment:

```bash
pip install "bkn-osdk @ https://github.com/openbkn-ai/bkn-sdk/archive/<sha>.zip#subdirectory=python"
```

## Generate

```bash
openbkn auth login https://your-platform      # the CLI owns the credential store
bkn-osdk generate <kn-id> --out ./bkn
```

`--out` is the package: Python imports it by that directory's name. The command
authenticates and fetches the whole schema **before** writing anything, and
refuses a directory it did not produce, so a mistyped path cannot overwrite
source. Regenerating an unchanged schema rewrites the same bytes, so a real
regeneration shows up as a reviewable `git diff`.

```text
bkn/
  __init__.py        # KN_ID, BRANCH, OBJECT_TYPES, RELATION_TYPES, METRICS,
                     #   search(), search_instances()
  object_types.py    # one class per object type
  relation_types.py  # relation endpoints and their join columns
  metrics.py         # one class per metric, with the dimensions it allows
  _meta.py           # fingerprint, format version, runtime range
```

Commit the generated package, pin `bkn-osdk~=0.1`, and run `bkn-osdk check` in
CI: it compares the live schema against the fingerprint and exits non-zero on
drift, classifying it as *additive* (new object type or property — existing code
keeps working) or *breaking* (removed, retyped, or rekeyed).

## Credentials

Both commands take `--base-url`, `--token` or `--token-file`, `--user` and
`--insecure`, which beat the environment and the store. That is what a CI job
wants, and what lets one Makefile generate from two deploys without editing its
own environment between the calls:

```bash
bkn-osdk generate <kn-id> --out ./bkn --base-url https://staging --token-file /run/secrets/bkn
bkn-osdk check ./bkn --base-url https://staging --token-file -   # or read it from stdin
```

A token passed as `--token` is visible in `ps` and in shell history; outside a
local shell, mount it and use `--token-file`.

Nothing is compiled into the generated package: the same KN commonly exists on a
dev and a prod platform, so it pins only `kn_id` and `branch`. Credentials
resolve at call time, innermost first:

1. the active `session(...)` scope,
2. the process default from `bkn_osdk.configure(...)`,
3. `BKN_TOKEN` / `BKN_BASE_URL`,
4. `~/.bkn/…/token.json` — the store `openbkn auth login` writes.

```python
import bkn_osdk
from bkn_osdk import session
from bkn.object_types import People

People.take(10)  # notebook: nothing to configure

bkn_osdk.configure(base_url=PROD, token=TOKEN)  # one platform, whole process

with session(token=user_token):  # a scope per request
    People.take(10)
```

The scope lives in a `ContextVar`, so threads and asyncio tasks each carry their
own — a multi-tenant server cannot leak one user's token into another's request.

A stored session refreshes itself when its access token expires mid-process. If
the platform rotates the refresh token, the replacement is written back to the
store, because spending the CLI's credential and keeping the new one would force
a re-login.

## Query

```python
from decimal import Decimal
from bkn.object_types import Order

Order.get(10357)  # Order | None
Order.count()  # respects the filter
Order.where(Order.order_status == "pending_payment").count()
Order.where((Order.total_amount > Decimal("10000")) & Order.paid_at.exists()).order_by(
    Order.total_amount.desc()
).select(Order.order_no, Order.total_amount).take(20)

for order in Order.iterate(page_size=500):  # pages with limit/offset
    ...
```

`~` negates a filter where the platform can express it: comparison operators
invert into each other, `in`/`like`/`exist` have paired negatives, and `and`/`or`
negate by De Morgan. `match` and `knn` have no opposite in the operator enum, so
`~` on them raises rather than inventing one.

`Order.total_amount` is a `PropertyRef` used to build filters; `order.total_amount`
is a `Decimal`. One name, two jobs — and both typed, so `People.age > 30` checks
and `People.name > 30` does not.

Decoding follows the declared type: a `decimal` arrives as a JSON string and
becomes an exact `Decimal`, a `datetime` keeps its offset. A property the query
did not return raises rather than reading as `None`.

Three things about the platform's filter grammar are worth knowing, all verified
against a live deploy:

- `like` semantics belong to the **backing resource**, and the two deploys probed
  disagree: a Postgres-backed object type read the value as a plain substring
  (`like("2026")` matched, `like("2026%")` did not), while a Vega-catalog-backed
  one read it as a SQL pattern (`like("%FIFA%")` matched, `like("FIFA")` did
  not). The value is sent verbatim; a wrong guess returns zero rows, not an
  error, so try both against your own object type.
- `match` is in the operator enum but a Postgres-backed object type answers 500.
- `limit` is 1–10000, and `total_count` is omitted entirely when nothing matched.

## Aggregate

There is no `sum()` or `group_by()` over an object set, because there is no
endpoint for one: an instance query takes a condition, a limit, an offset and a
property selection, and `need_total` returns a row count. Pulling every row back
to aggregate client-side would be a lie dressed as an API.

The platform's aggregation surface is **metrics**, and it is richer than that
would have been — dimensions, a filter on the aggregate, ordering, and a time
window:

```python
from bkn.metrics import Gmv

Gmv.query(
    time={"start": 1751328000, "end": 1753920000, "step": "day"},  # unix seconds
    analysis_dimensions=["channel_id"],
    condition=Order.order_status == "paid",
    having={"field": "gmv", "operation": ">", "value": 100},
    order_by=[("gmv", "desc")],
)
```

Metrics reach the generated package from the object types they are mounted on,
so `Gmv.__dimensions__` records the only splits the tool accepts and a wrong one
is refused before the round trip. The time rules are checked locally too:
`instant=True` takes a point, a series needs a `step`, and `start`/`end` come as
a pair. Note the unit: `query_metric` documents **unix seconds**, while the same
metric's logic-property parameters document milliseconds — a different call path
with a different unit.

The transport is `POST …/metrics/{metric_id}/data` — the same REST layer as every
other read. Conditions **merge rather than override**: the platform ANDs the
metric definition's own condition, the one passed here, and the time range. The
`metrics=` argument passes the period-over-period / share block through verbatim.

## Traverse

One hop is a filter on the target object type, using the join columns the schema
declares — no session, no second grammar:

```python
order = Order.get(10357)
order.order_user.take(10)  # User.where(User.user_id == order.user_id)
```

Several hops have to be joined server-side, which rides the REST subgraph
endpoint — still an ordinary read, no session:

```python
Order.order_user.then(User.user_address).of(order, step_limit=20)
```

That endpoint's seed-based form walks *every* relation up to the path length, so
the requested chain is selected from the paths it reports back, and a `where()`
on the far end is applied locally (it filters only its starting object type).
Three hops is its ceiling.

## Evidence

Reads through `session(traced=True)` go over MCP inside one managed interaction —
opened on the first read, reused, finished on exit — and come back with a
receipt: the operation id, the normalised input hash, and the business refs
resolved down to property granularity.

```python
with bkn_osdk.session(traced=True):
    page = Order.objects().page(limit=10)
    page.receipt["operation_id"]
    page.rows[0].__receipt__  # the same receipt, on each row it accounts for
```

The tool accepts neither `sort` nor `need_total` and honours neither, so a query
wanting either takes the REST path even inside a traced scope — carrying the
scope's turn, so it is still recorded, but answering without an in-band receipt.
Dropping the keys instead would return an unsorted page, or a count of zero for
a set with matches: a wrong answer bought with a receipt. Untraced reads take
REST throughout, which is faster, and carry no receipt.

Which calls need a turn is a matter of surface, not of tool. The capability
surface — the MCP tools and their REST twins under `/kn/` — refuses a
context-free call: every tool in the catalog bar the two lifecycle ones declares
`bkn_context` required. So `search`, `search_instances` and any direct
`call_tool` carry a turn on the first attempt, joining the scope's own where
there is one and opening a short-lived turn where there is not. The read routes
under `ontology-query` — instances, subgraph, metrics — serve a bare request, so
they send one and mint nothing; only a deploy that refuses gets a turn opened
for the retry.

A caller that already has a turn passes it in without a traced scope, which is
how the sandbox does it — `BKN_CONVERSATION_ID` and `BKN_INTERACTION_ID` in the
environment, inherited with no argument passing, and never finished by this SDK
because it does not own them.

## Search

Search is network-level — its request has no object-type dimension — so it lives
on the package. It calls the `search_schema` MCP tool, the same one the
TypeScript SDK calls, and answers with the object, relation, action and metric
types a question touches:

```python
import bkn

bkn.search("who owns supply chain")
bkn.search("orders and their buyers", max_concepts=3, search_scope={"include_action_types": False})
```

`search_instances` asks the other question — not which types a question touches
but which rows answer it — over the `search_instance` tool. Recall runs two
channels, vector and full text, so only properties whose `condition_operations`
include `match` or `knn` take part and a type with no index contributes nothing:

```python
bkn.search_instances("Lionel Messi")
bkn.search_instances("欠款最多的客户", object_types=["customer"], rerank=True)
```

It is where to start when neither the type name nor the field name is known.
Once both are, a typed query is cheaper and exact.

## The platform layer

Everything the generated classes do not cover — every other network, every
capability, every route — is reached here:

```python
bkn_osdk.call("/api/agent-observability/v1/traces", query={"limit": 10})   # REST, by path
bkn_osdk.call("/api/safe/v1/me/api-keys")                                 # anything else

ctx = bkn_osdk.resolve_context()
bkn_osdk.tool_catalog(ctx)                            # what this deploy publishes
bkn_osdk.call_tool(ctx, kn_id, "run_sql", {"kn_id": kn_id, "sql": …, "bkn_context": …})
```

`call_tool` is the raw seam: it takes the arguments the catalog declares and
returns what the tool answered, with no shape of its own — including the
envelope, which differs by build. Passing a `bkn_context` is the caller's job
there, and `ensure_interaction` is how to get one:

```python
from bkn_osdk.lifecycle import ensure_interaction

with ensure_interaction(ctx, kn_id) as turn:
    arguments = {"kn_id": kn_id, "bkn_context": turn.bkn_context}
    bkn_osdk.call_tool(ctx, kn_id, "list_skills", arguments)
```

### Named functions for the capability routes

The context-loader surface — 23 routes under `/api/agent-retrieval/v1/kn/` — is
also generated, from foundry's own OpenAPI:

```python
from bkn_osdk import kn

kn.list_resources(KN_ID)
kn.run_sql(KN_ID, "SELECT COUNT(*) AS n FROM {{.d9hff…}}")
kn.query_object_instance(KN_ID, "order", limit=10, response_format="json")
```

Three things the wrapper knows and a raw call does not: **which arguments go in
the query string** rather than the body (`query_object_instance` and both
subgraph routes split them, and sending `kn_id` in the body answers
`Public.NotFound` — "对象不存在" — which reads as a missing object type); which
arguments are required; and that every route on this surface needs a turn, so
`bkn_context` is attached rather than being a parameter. `kn_id` is the first
argument everywhere, because the turn belongs to a network even where the route
does not send one.

The spec is frozen in `contracts/kn-rest.json` and regenerated by
`scripts/capture_kn_contract.py`; `bkn_osdk/kn.py` is committed, and a test
fails if regenerating would change it. `call_tool` remains for the tools with no
REST twin, and for arguments a route accepts but does not publish.

`search` and `search_instances` are the same thing wrapped by hand.
[`examples/platform/`](examples/platform) runs the whole surface.

## Examples

Six runnable scripts under [`examples/`](examples): [`credentials.py`](examples/credentials.py)
(which platform, as whom, and where that was decided), three under `ontology/`
(explore, query, evidence) and two under `platform/` (the tool surface, the
sandbox).

## Upgrades

| What moves | You run | Guard |
| --- | --- | --- |
| runtime | `pip install -U bkn-osdk` | `REQUIRES_RUNTIME`, checked at import |
| KN schema | `bkn-osdk generate` again | `SCHEMA_FINGERPRINT` + `bkn-osdk check` |
| emitted code shape | regenerate | `FORMAT_VERSION` |

A runtime upgrade never requires regeneration — that is why generated packages
carry declarations and no logic. `configure(check_schema=True)` adds one
fingerprint check on the first query, for callers who would rather fail loudly
than read a stale attribute.

## Not in this release

Writes and action execution, aggregation over an object set (no endpoint exists —
see above), typed wrappers for the rest of the catalog's tools — `find_skills`,
`describe_resource`, `query_instance_subgraph` and the others reachable today
only through `call_tool` — an async client, and offline generation from a local
`.bkn` directory. Each has a section in
[the design](../docs/superpowers/specs/2026-08-11-python-osdk-design.md)
describing the shape it takes when it lands.

## Development

```bash
uv venv && uv pip install -e ".[dev]"
python -m pytest -q          # unit tests, all offline
python -m mypy               # strict
python -m ruff check . && python -m ruff format --check .
```

Wire behaviour is pinned by exchanges recorded from a live platform under
`tests/fixtures/`; re-record with `scripts/capture_schema_fixtures.py` and
`scripts/capture_query_fixtures.py` when a contract moves.

Recorded fixtures cannot notice a route being withdrawn, so there is a live
suite as well. It generates a package for a real network, type-checks it, reads
through it and closes a real interaction — and it skips itself unless asked for:

```bash
BKN_E2E=1 BKN_E2E_KN=ecommerce_ops_bkn_public BKN_BASE_URL=https://your-platform \
  python -m pytest tests/e2e -q
```

`BKN_E2E_OBJECT_TYPE` pins the class under test; without it the suite picks a
populated type that has relations to walk. Credentials resolve as they do for
any caller, so `openbkn auth login` is enough. Run it against more than one
deploy: the two this SDK was built against have disagreed about route names,
metrics, and which reads their data resources can serve.

### Function Trace parent

When the sandbox supplies `BKN_PARENT_OPERATION_ID` together with its conversation
and interaction IDs, internal reads send it as `bkn_context.parent_operation_id`.
Each read keeps its own operation and receipt. An explicit override to a different
turn does not inherit the sandbox's parent. Business functions need no new argument.
