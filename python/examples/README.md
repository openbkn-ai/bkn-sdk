# Examples

Five scripts, each runnable against a live platform, split by the layer they
work at:

- [`ontology/`](ontology) — reading one knowledge network through classes
  generated from its schema.
- [`platform/`](platform) — addressing the platform itself: any route, any tool.

They take the network from `BKN_KN_ID` and the platform from the usual places —
`BKN_BASE_URL`, or whatever `openbkn auth login` wrote:

```bash
export BKN_BASE_URL=https://your-platform
export BKN_KN_ID=ecommerce_ops_bkn_public
export PYTHONPATH=examples          # so the scripts can share `bootstrap.py`

python examples/ontology/explore.py "最近的大额订单"
BKN_OBJECT_TYPE=order python examples/ontology/query.py
BKN_OBJECT_TYPE=order python examples/ontology/traced.py
python examples/platform/tools.py
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
| [`sandbox.py`](platform/sandbox.py) | Running code in the platform's sandbox through `/function/execute`, passing the caller's turn in so the SDK inside inherits it. Platform-layer on this side; the code it sends uses the ontology layer over there. |

[`bootstrap.py`](bootstrap.py) is shared: it generates the package for
`BKN_KN_ID` into `~/.cache/bkn-osdk` on first use and imports it from there. A
service generates once and commits the package instead — that is the point of
generating it — but a script is exactly the case where that ceremony costs more
than it pays.

Nothing here is pinned to one network. The ontology examples read whichever
object type `BKN_OBJECT_TYPE` names and use whatever properties it declares, so
they run against a network they have never seen.
