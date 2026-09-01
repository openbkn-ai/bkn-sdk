# Examples

Eight scripts, each runnable against a live platform. One is about getting
connected at all; the rest are split by the layer they work at:

- [`credentials.py`](credentials.py) — which platform, as whom, and where that
  was decided.
- [`ontology/`](ontology) — reading one knowledge network through classes
  generated from its schema.
- [`platform/`](platform) — addressing the platform itself: any route, any tool.

## Running them

Three commands before the first script, in this order.

**1. Install the SDK.** Python 3.10 or newer; its only dependency is `httpx`.

```bash
pip install "bkn-osdk @ git+https://github.com/openbkn-ai/bkn-sdk@<sha>#subdirectory=python"
```

**2. Log in to a platform.** This writes `~/.bkn`, which every script reads —
nothing below names a platform or a token. `-k` is for the self-signed
certificate an IP deploy serves, and it is remembered per platform.

```bash
openbkn auth login --base-url https://14.103.77.23 -u admin -p '…' -k
```

`openbkn` is the TypeScript CLI (`npm i -g @openbkn/bkn-sdk`). Without it, set
`BKN_BASE_URL` and `BKN_TOKEN` instead — the difference is that a stored login
refreshes itself when the token expires and an environment variable cannot.

**3. Name a network.** `BKN_KN_ID` is required by every script; the scripts that
read one object type take `BKN_OBJECT_TYPE`, which defaults to `order`.

```bash
export BKN_KN_ID=ecommerce_ops_bkn_public
export BKN_OBJECT_TYPE=order
```

Do not know the id? `python examples/platform/networks.py` lists what the deploy
has — it is the one script that needs no network of its own beyond the listing.

Then run any script by path. Nothing else to set up — each finds its own
`bootstrap.py`, so there is no `PYTHONPATH` to export and the working directory
does not matter:

```bash
python examples/credentials.py                        # which platform, as whom
python examples/ontology/explore.py "最近的大额订单"
python examples/ontology/query.py
python examples/ontology/traced.py
python examples/platform/networks.py
python examples/platform/tools.py
python examples/platform/capabilities.py
python examples/platform/sandbox.py
```

Running them from a clone rather than an install works the same way, from the
`python/` directory:

```bash
uv venv && uv pip install -e ".[dev]"
BKN_KN_ID=… .venv/bin/python examples/ontology/query.py
```

`BKN_KN_ID` is the only one that is always required — a script says so and exits
if it is missing. `BKN_OBJECT_TYPE` defaults to `order`; point it at a type your
own network has. Both platform address and token come from the chain below, so
neither appears on these command lines.

## Where the credentials come from

One command, and then nothing in the code:

```bash
openbkn auth login --base-url https://14.103.77.23 -u admin -p '…' -k
```

`-k` is for the self-signed certificate an IP deploy serves, and it is
remembered per platform. That login is also the only source with a refresh
token — one from `BKN_TOKEN` or an AppKey cannot be renewed when it expires,
while a stored session is refreshed in place.

[`credentials.py`](credentials.py) prints what each level resolves to, which is
the fastest way to see why a call is going somewhere you did not expect:

```bash
python examples/credentials.py
```

```text
默认             https://14.103.77.23     token=ory_at__bb…            来自 store, 可刷新
环境变量           https://14.103.77.23     token=token-from-env         来自 显式给的, 不可刷新
configure      https://14.103.77.23     token=token-from-configure   来自 显式给的, 不可刷新
session 内      https://14.103.77.23     token=token-from-session     来自 显式给的, 不可刷新
session 退出后    https://14.103.77.23     token=token-from-configure   来自 显式给的, 不可刷新
```

## The ontology layer

| | |
| --- | --- |
| [`explore.py`](ontology/explore.py) | A question, when you do not know the network's names yet: `search` for the types it touches, `search_instances` for the rows, then the generated class for the exact query. |
| [`query.py`](ontology/query.py) | One object type: filters and `~`, ordering, a property subset, paging with a total, `iterate`, `get` by key, and a relation hop. |
| [`traced.py`](ontology/traced.py) | One managed turn: every read inside the scope joins it, each comes back with a receipt, and `count()` still answers truthfully. |

## The platform layer

| | |
| --- | --- |
| [`tools.py`](platform/tools.py) | The deploy's tool catalog read as the contract it is, REST by path, tools by name with a turn attached, and `run_sql` for the aggregation no typed form covers. |
| [`networks.py`](platform/networks.py) | The ontology as `bkn-backend` stores it — which networks exist, and one network's object types, join columns, metric definitions, action types and concept groups — then the same question asked by natural language through `search_schema` / `search_instance`. This is what the generator reads; the last line prints its fingerprint. |
| [`capabilities.py`](platform/capabilities.py) | The same surface through `bkn_osdk.kn` — generated functions, so the arguments, the query/body split and the turn all come from the contract. Chained the way real work chains: most routes need an id an earlier call produced. |
| [`sandbox.py`](platform/sandbox.py) | Running code in the platform's sandbox through `/function/execute`, passing the caller's turn in so the SDK inside inherits it. Platform-layer on this side; the code it sends uses the ontology layer over there. |

[`bootstrap.py`](bootstrap.py) is shared: it generates the package for
`BKN_KN_ID` into `~/.cache/bkn-osdk` on first use and imports it from there. A
service generates once and commits the package instead — that is the point of
generating it — but a script is exactly the case where that ceremony costs more
than it pays.

Nothing here is pinned to one network. The ontology examples read whichever
object type `BKN_OBJECT_TYPE` names and use whatever properties it declares, so
they run against a network they have never seen.
