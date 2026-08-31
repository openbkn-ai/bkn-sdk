# Examples

Seven scripts, each runnable against a live platform. One is about getting
connected at all; the rest are split by the layer they work at:

- [`credentials.py`](credentials.py) — which platform, as whom, and where that
  was decided.
- [`ontology/`](ontology) — reading one knowledge network through classes
  generated from its schema.
- [`platform/`](platform) — addressing the platform itself: any route, any tool.

## First: a platform and a token

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

## Then the rest

The examples take the network from `BKN_KN_ID` and the platform from wherever
the chain above resolves it:

```bash
export BKN_KN_ID=ecommerce_ops_bkn_public
export PYTHONPATH=examples          # so the scripts can share `bootstrap.py`

python examples/ontology/explore.py "最近的大额订单"
BKN_OBJECT_TYPE=order python examples/ontology/query.py
BKN_OBJECT_TYPE=order python examples/ontology/traced.py
python examples/platform/tools.py
BKN_OBJECT_TYPE=order python examples/platform/capabilities.py
BKN_OBJECT_TYPE=order python examples/platform/sandbox.py
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
