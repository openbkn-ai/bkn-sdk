# Examples

Four scripts, each runnable against a live platform. They take the network from
`BKN_KN_ID` and the platform from the usual places — `BKN_BASE_URL`, or whatever
`openbkn auth login` wrote:

```bash
export BKN_BASE_URL=https://your-platform
export BKN_KN_ID=ecommerce_ops_bkn_public
export PYTHONPATH=examples          # so the scripts can share `bootstrap.py`

python examples/explore.py "最近的大额订单"
BKN_OBJECT_TYPE=order python examples/query.py
BKN_OBJECT_TYPE=order python examples/traced.py
BKN_OBJECT_TYPE=order python examples/in_sandbox.py
python examples/runtime.py
```

| | |
| --- | --- |
| [`explore.py`](explore.py) | A question, when you do not know the network's names yet: `search` for the types it touches, `search_instances` for the rows, then the generated class for the exact query. |
| [`query.py`](query.py) | One object type: filters and `~`, ordering, a property subset, paging with a total, `iterate`, `get` by key, and a relation hop. |
| [`traced.py`](traced.py) | One managed turn: every read inside the scope joins it, each comes back with a receipt, and `count()` still answers truthfully. |
| [`in_sandbox.py`](in_sandbox.py) | The same SDK running inside the platform's sandbox, inheriting the caller's turn through the environment. |
| [`runtime.py`](runtime.py) | Below the generated classes: the deploy's tool catalog, REST by path, tools by name, and `run_sql` for the aggregation no typed form covers. |

[`bootstrap.py`](bootstrap.py) is shared: it generates the package for
`BKN_KN_ID` into `~/.cache/bkn-osdk` on first use and imports it from there. A
service generates once and commits the package instead — that is the point of
generating it — but a script is exactly the case where that ceremony costs more
than it pays.

Nothing here is pinned to one network. `query.py` and `traced.py` read whichever
object type `BKN_OBJECT_TYPE` names and use whatever properties it declares, so
they run against a network they have never seen.
