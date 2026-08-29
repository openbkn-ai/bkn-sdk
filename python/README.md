# bkn-osdk

A typed, read-only Python SDK for **one** knowledge network, produced by
generating code from that network's schema. Modelled on Palantir's OSDK: point
the generator at a KN, get a package whose classes *are* that KN's object types.

```python
from bkn.object_types import People

People.where(People.age > 30).take(10)
```

This is not a port of the TypeScript SDK. That one wraps eleven backend
namespaces in HTTP calls, which buys a Python caller nothing that
`bkn_osdk.call("/api/…")` does not. Generated classes over an ontology cannot be
replaced by a raw call, which is why they are worth a second language.

## Install

Not on PyPI. Install from a tag — the package lives in a subdirectory of this
repository, which pip addresses directly:

```bash
pip install "bkn-osdk @ git+https://github.com/openbkn-ai/bkn-sdk@v0.1.0#subdirectory=python"
```

Its only dependency is `httpx`, so an image build is one line:

```dockerfile
RUN pip install --no-cache-dir \
    "bkn-osdk @ git+https://github.com/openbkn-ai/bkn-sdk@v0.1.0#subdirectory=python"
```

A direct URL dependency carries no index, so the tag pins the version and
`pip install -U` will not find a newer one — moving versions means editing that
line. Where git is unavailable, the release tarball works the same way:
`…/archive/refs/tags/v0.1.0.tar.gz#subdirectory=python`.

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
  __init__.py        # KN_ID, BRANCH, OBJECT_TYPES, RELATION_TYPES, METRICS, search()
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

The trade is deliberate: the traced path cannot sort or count, because the tool
accepts neither `sort` nor `need_total` — so those keys are dropped rather than
sent and ignored in silence. Untraced reads take the REST path, which is faster
and strictly more capable for reading, and carry no receipt.

Some deploys enforce the lifecycle contract on the REST surface as well, and
answer a context-free read with `conversation_required`. Nothing has to be
configured for that: the first request goes out bare, and if it is refused this
way an interaction is opened and the request repeated — inside the scope's own
interaction where there is one, otherwise on a short-lived turn of its own. A
deploy that does not enforce it pays nothing.

## Search

Semantic search is network-level — its request has no object-type dimension — so
it lives on the package:

```python
import bkn

bkn.search("who owns supply chain")
```

## Everything else

The remaining backend surface is reachable without a typed wrapper:

```python
bkn_osdk.call("/api/dataflow-manager/v1/flows")
```

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
see above), generated MCP
tool wrappers, an async client, and offline generation from a local `.bkn`
directory. Each has a section in
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
