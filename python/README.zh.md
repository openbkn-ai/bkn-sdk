# bkn-osdk

*[English](README.md)*

BKN 的 Python SDK，分两层。

**本体层**只读、有类型、只覆盖**一个**知识网络 —— 从该网络的 schema 生成，做法照 Palantir 的 OSDK：

```python
from bkn.object_types import People

People.where(People.age > 30).take(10)
```

**平台层**面向平台自己：任何 REST 路由按路径调，任何部署公布的工具按名字调。

```python
bkn_osdk.call("/api/agent-observability/v1/traces", query={"limit": 10})
bkn_osdk.call_tool(ctx, kn_id, "describe_resource", {"resource_id": "…", ...})
```

两层**按"寻址什么"命名，不按"怎么造出来的"** —— 一层是生成的、一层是手写的，那是实现事实，调用方不需要据此推理。两层走同一套凭据、同一套传输、同一个受管 turn，所以为一次调用下沉到平台层再回来，证据仍在同一条链上。

这不是 TypeScript SDK 的移植。那边把十一个后端命名空间包成 HTTP 调用，对 Python 调用方来说，这些 `bkn_osdk.call("/api/…")` 都能做。真正无法用裸调用替代的是本体之上的生成类 —— 这才是值得再写一个语言版本的理由。

**目标平台版本 0.1.5。** 负载逐字透传，而 0.1.4 线送的形状不一样：它把 `get_kn_detail`、`list_resources`、`list_skills`、`get_object_types`、`list_knowledge_networks` 套在 `result` 键下，并提供 0.1.5 已下线的 `semantic-search` 路由。连老部署不是不行，但脱壳和换路由是调用方自己的事。

## 安装

未发 PyPI。包在本仓库的子目录里，pip 可以直接寻址：

```bash
pip install "bkn-osdk @ git+https://github.com/openbkn-ai/bkn-sdk@<sha>#subdirectory=python"
```

唯一依赖是 `httpx`，所以镜像构建就一行：

```dockerfile
RUN pip install --no-cache-dir \
    "bkn-osdk @ git+https://github.com/openbkn-ai/bkn-sdk@<sha>#subdirectory=python"
```

**钉 commit，不要钉分支。** 直接 URL 依赖没有索引，没人替你解析"最新版"，换版本就得改这一行 —— 这正是它的价值。分支名看着能省掉这次修改，其实不能：pip 的 wheel 缓存按 URL 命中，所以对同一分支重新构建可能装回它已有的旧构建，报成功、装的是上一个 commit。装完的 `direct_url.json` 里记着实际落地的是哪个 commit。

没装 `git` 的地方（沙箱镜像就是），归档地址吃同样的 fragment：

```bash
pip install "bkn-osdk @ https://github.com/openbkn-ai/bkn-sdk/archive/<sha>.zip#subdirectory=python"
```

## 生成

```bash
openbkn auth login https://your-platform      # 凭据 store 归 CLI 管
bkn-osdk generate <kn-id> --out ./bkn
```

`--out` 就是包本身：Python 按这个目录名 import 它。命令先认证、先取完整 schema，**然后**才落盘；并且拒绝写入不是它生成的目录，所以路径打错不会覆盖源码。schema 没变时重跑写出同样的字节，因此真实的 schema 变更会表现为一份可评审的 `git diff`。

```text
bkn/
  __init__.py        # KN_ID、BRANCH、OBJECT_TYPES、RELATION_TYPES、METRICS、
                     #   search()、search_instances()
  object_types.py    # 每个对象类一个类
  relation_types.py  # 关系端点及其 join 列
  metrics.py         # 每个指标一个类，带它允许的维度
  _meta.py           # 指纹、格式版本、运行时版本范围
```

把生成的包提交进版本库，依赖钉 `bkn-osdk~=0.1`，CI 里跑 `bkn-osdk check`：它拿线上 schema 比对指纹，漂移就非零退出，并区分 *additive*（新增对象类或属性，老代码照常）与 *breaking*（删除、改类型、改主键）。

## 凭据

两个命令都接受 `--base-url`、`--token` / `--token-file`、`--user`、`--insecure`，它们压过环境变量和 store。CI 要的就是这个；一份 Makefile 要对两个部署各生成一次时，也不必在两次调用之间改自己的环境变量：

```bash
bkn-osdk generate <kn-id> --out ./bkn --base-url https://staging --token-file /run/secrets/bkn
bkn-osdk check ./bkn --base-url https://staging --token-file -   # 也可以从 stdin 读
```

`--token` 传的值会出现在 `ps` 和 shell 历史里；本地壳之外，把它挂成文件用 `--token-file`。

生成的包里不编译任何凭据信息：同一个 KN 常常在 dev 和 prod 各有一份，所以它只钉 `kn_id` 和 `branch`。凭据在调用时解析，由内向外：

1. 当前的 `session(...)` 作用域
2. `bkn_osdk.configure(...)` 设的进程默认值
3. `BKN_TOKEN` / `BKN_BASE_URL`
4. `~/.bkn/…/token.json` —— `openbkn auth login` 写的那份 store

```python
import bkn_osdk
from bkn_osdk import session
from bkn.object_types import People

People.take(10)  # 笔记本里：什么都不用配

bkn_osdk.configure(base_url=PROD, token=TOKEN)  # 单平台，整个进程

with session(token=user_token):  # 每个请求一个作用域
    People.take(10)
```

作用域存在 `ContextVar` 里，所以线程和 asyncio 任务各自持有自己的 —— 多租户服务不会把一个用户的 token 漏进另一个用户的请求。

**只有 store 里的会话能刷新。** access token 在进程运行中过期时它自己换新的；平台若轮换了 refresh token，新的会写回 store —— 花掉了 CLI 的凭据却不还回去，会逼人重新登录。从环境变量或 AppKey 拿到的 token 没有刷新一说，过期就是过期。

自签名证书（IP 部署基本都是）用 `--insecure` / `insecure=True`；`openbkn auth login -k` 会把它按平台记进 store，之后不用再说。[`examples/credentials.py`](examples/credentials.py) 会把每一级解析出什么打出来。

## 查询

```python
from decimal import Decimal
from bkn.object_types import Order

Order.get(10357)  # Order | None
Order.count()  # 受过滤条件约束
Order.where(Order.order_status == "pending_payment").count()
Order.where((Order.total_amount > Decimal("10000")) & Order.paid_at.exists()).order_by(
    Order.total_amount.desc()
).select(Order.order_no, Order.total_amount).take(20)

for order in Order.iterate(page_size=500):  # 按 limit/offset 翻页
    ...
```

`~` 在平台表达得了的地方对条件取反：比较运算符互相反转，`in` / `like` / `exist` 各有配对的否定式，`and` / `or` 按德摩根律取反。`match` 和 `knn` 在算子枚举里没有对立面，所以对它们用 `~` 会直接报错，而不是现编一个。

`Order.total_amount` 是用来构造条件的 `PropertyRef`，`order.total_amount` 是一个 `Decimal`。同一个名字，两件事 —— 而且都有类型，所以 `People.age > 30` 能通过检查，`People.name > 30` 不能。

解码按声明的类型走：`decimal` 以 JSON 字符串到达并变成精确的 `Decimal`，`datetime` 保留时区偏移。查询没返回的属性会报错，而不是读成 `None`。

平台的过滤语法有三件事值得知道，都在真实部署上验过：

- `like` 的语义属于**背后的数据资源**，实测两个部署的行为不同：Postgres 支撑的对象类把值当普通子串（`like("2026")` 命中，`like("2026%")` 不中），Vega catalog 支撑的当 SQL 模式（`like("%FIFA%")` 命中，`like("FIFA")` 不中）。值是逐字发出去的，猜错返回零行而不是报错，所以拿你自己的对象类两种都试一下。
- `match` 在算子枚举里，但 Postgres 支撑的对象类会 500。
- `limit` 取值 1–10000，且**零命中时 `total_count` 整个字段不出现**。

## 聚合

对象集上没有 `sum()` 或 `group_by()`，因为平台没有对应的端点：实例查询接受条件、limit、offset 和属性选择，`need_total` 给行数。把所有行拉回本地再聚合，是把谎言包装成 API。

平台的聚合面是**指标**，而且比前者更强 —— 维度、对聚合值的过滤、排序、时间窗：

```python
from bkn.metrics import Gmv

Gmv.query(
    time={"start": 1751328000, "end": 1753920000, "step": "day"},  # unix 秒
    analysis_dimensions=["channel_id"],
    condition=Order.order_status == "paid",
    having={"field": "gmv", "operation": ">", "value": 100},
    order_by=[("gmv", "desc")],
)
```

指标是从它挂载的对象类进入生成包的，所以 `Gmv.__dimensions__` 记着该工具唯一接受的那些切分维度，传错的在发请求之前就被拒。时间规则也在本地检查：`instant=True` 取一个时间点，取序列必须给 `step`，`start` / `end` 必须成对。注意单位：`query_metric` 文档写的是 **unix 秒**，而同一指标的 logic-property 参数文档写的是毫秒 —— 不同的调用路径，不同的单位。

传输是 `POST …/metrics/{metric_id}/data`，和其他所有读走同一层 REST。条件是**合并而不是覆盖**：平台把指标定义自带的条件、这里传的条件、时间范围三者 AND 起来。`metrics=` 参数把同比环比 / 占比那一块逐字透传。

## 遍历

一跳就是对目标对象类的一次过滤，用 schema 声明的 join 列 —— 不需要会话，也没有第二套语法：

```python
order = Order.get(10357)
order.order_user.take(10)  # 等价于 User.where(User.user_id == order.user_id)
```

多跳必须在服务端 join，走 REST 的 subgraph 端点 —— 仍然是一次普通的读，不需要会话：

```python
Order.order_user.then(User.user_address).of(order, step_limit=20)
```

该端点的种子式调用会把路径长度以内的**所有**关系都走一遍，所以请求的那条链是从它回报的路径里筛出来的；远端的 `where()` 在本地生效（端点的过滤只作用于起点对象类）。三跳是它的上限。

## 证据链

`session(traced=True)` 下的读走 MCP，落在一个受管交互里 —— 第一次读时打开，之后复用，退出时关闭 —— 并带回执：操作 id、归一化输入哈希、精确到属性粒度的业务引用。

```python
with bkn_osdk.session(traced=True):
    page = Order.objects().page(limit=10)
    page.receipt["operation_id"]
    page.rows[0].__receipt__  # 同一份回执，挂在它所解释的每一行上
```

那个工具收下 `sort` 和 `need_total` 但两个都不认，所以需要其中任一个的查询**即使在 traced 作用域里也走 REST** —— 带着该作用域的 turn，所以照样被记录，只是拿不到随包回执。反过来把这两个键丢掉，会返回一个没排序的页，或者给一个有匹配的集合报 0 —— 那是用回执换来的错答案。不带 traced 的读全程走 REST，更快，不带回执。

**哪些调用需要 turn，取决于"面"，不取决于工具。** 能力面 —— MCP 工具和它们在 `/kn/` 下的 REST 孪生 —— 拒绝没有上下文的调用：catalog 里除两个生命周期工具外，每个都把 `bkn_context` 标成 required。所以 `search`、`search_instances` 以及任何直接的 `call_tool` 第一次就带上 turn：作用域里有就用它的，没有就开一个短命的。`ontology-query` 下的读路由 —— 实例、子图、指标 —— 接受裸请求，所以先裸发、不凭空造 turn；只有拒绝它的部署才会为重试开一个。

已经持有 turn 的调用方不必开 traced 作用域，直接传进来即可 —— 沙箱就是这么做的：`BKN_CONVERSATION_ID` 和 `BKN_INTERACTION_ID` 放在环境里，无需显式传参就被继承，并且 SDK 绝不去 finish 它，因为那不是它的。

## 搜索

搜索是网络级的 —— 它的请求里没有对象类这一维 —— 所以它挂在包上而不是类上。它调 `search_schema` 这个 MCP 工具（TypeScript SDK 调的是同一个），回答一个问题触及哪些对象类、关系类、行动类和指标类：

```python
import bkn

bkn.search("谁负责供应链")
bkn.search("订单和它们的买家", max_concepts=3, search_scope={"include_action_types": False})
```

`search_instances` 问的是另一个问题 —— 不是"触及哪些类"，而是"哪些行能回答" —— 走 `search_instance` 工具。召回是向量和全文两路并发，所以只有 `condition_operations` 里含 `match` 或 `knn` 的属性参与，没建索引的对象类不会出实例：

```python
bkn.search_instances("Lionel Messi")
bkn.search_instances("欠款最多的客户", object_types=["customer"], rerank=True)
```

类名和字段名都不知道时从这里开始。两者都知道之后，类型化查询更便宜也更准。

## 平台层

生成类覆盖不到的一切 —— 别的网络、别的能力、别的路由 —— 都从这里走：

```python
bkn_osdk.call("/api/agent-observability/v1/traces", query={"limit": 10})   # REST，按路径
bkn_osdk.call("/api/safe/v1/me/api-keys")                                 # 别的什么也一样

ctx = bkn_osdk.resolve_context()
bkn_osdk.tool_catalog(ctx)                            # 这个部署公布了什么
bkn_osdk.call_tool(ctx, kn_id, "run_sql", {"kn_id": kn_id, "sql": …, "bkn_context": …})
```

`call_tool` 是裸接缝：它接受 catalog 声明的参数，返回工具答的东西，不加任何自己的形状 —— 包括信封，而信封随构建版本不同。这里的 `bkn_context` 要调用方自己给，`ensure_interaction` 是拿到它的办法：

```python
from bkn_osdk.lifecycle import ensure_interaction

with ensure_interaction(ctx, kn_id) as turn:
    arguments = {"kn_id": kn_id, "bkn_context": turn.bkn_context}
    bkn_osdk.call_tool(ctx, kn_id, "list_skills", arguments)
```

### 能力路由的命名函数

context-loader 那一圈 —— `/api/agent-retrieval/v1/kn/` 下的 23 条路由 —— 也是生成的，源头是 foundry 自己的 OpenAPI：

```python
from bkn_osdk import kn

kn.list_resources(KN_ID)
kn.run_sql(KN_ID, "SELECT COUNT(*) AS n FROM {{.d9hff…}}")
kn.query_object_instance(KN_ID, "order", limit=10, response_format="json")
```

包装知道三件裸调用不知道的事：**哪些参数走 query 而不是 body**（`query_object_instance` 和两条 subgraph 路由都是拆开的，把 `kn_id` 塞进 body 会得到 `Public.NotFound`「对象不存在」，看着像对象类不存在）；哪些参数必填；以及这一面每条路由都要 turn，所以 `bkn_context` 由运行时挂上、不出现在签名里。`kn_id` 是每个函数的第一个参数 —— 即使路由自己不发它，turn 也属于某个知识网络。

契约冻在 `contracts/kn-rest.json`，由 `scripts/capture_kn_contract.py` 重新抓取；`bkn_osdk/kn.py` 提交进仓库，重新生成会改动它的话测试就红。没有 REST 孪生的工具、以及路由接受但没公布的参数，仍然走 `call_tool`。

`search` 和 `search_instances` 就是同一件事手写的版本。[`examples/platform/`](examples/platform) 把整个面跑了一遍。

## 示例

六个能跑的脚本，见 [`examples/`](examples)：[`credentials.py`](examples/credentials.py)（连哪个平台、以谁的身份、这是在哪一级决定的）、`ontology/` 三个（探索、查询、证据链）、`platform/` 两个（工具面、沙箱）。

## 升级

| 变的是什么 | 你要做的 | 守卫 |
| --- | --- | --- |
| 运行时 | `pip install -U bkn-osdk` | `REQUIRES_RUNTIME`，import 时检查 |
| KN schema | 重跑 `bkn-osdk generate` | `SCHEMA_FINGERPRINT` + `bkn-osdk check` |
| 生成代码的形状 | 重新生成 | `FORMAT_VERSION` |

升级运行时从不需要重新生成 —— 这正是生成包里只有声明、没有逻辑的原因。`configure(check_schema=True)` 会在第一次查询时加一次指纹检查，适合"宁可大声失败也不要读到过期属性"的调用方。

## 这个版本没有的

写入与行动执行、对象集上的聚合（没有对应端点，见上）、catalog 里其余工具的类型化包装 —— `find_skills`、`describe_resource`、`query_instance_subgraph` 等目前只能通过 `call_tool` 触达 —— 异步客户端，以及从本地 `.bkn` 目录离线生成。每一项在[设计文档](../docs/superpowers/specs/2026-08-11-python-osdk-design.md)里都有一节，写明它落地时会长成什么样。

## 开发

```bash
uv venv && uv pip install -e ".[dev]"
python -m pytest -q          # 单元测试，全部离线
python -m mypy               # strict
python -m ruff check . && python -m ruff format --check .
```

线上行为由 `tests/fixtures/` 下从真实平台录下来的交互钉住；契约变了就用 `scripts/capture_schema_fixtures.py` 和 `scripts/capture_query_fixtures.py` 重录。

录下来的样本发现不了"某个路由被下线"，所以还有一套 live 测试。它为一个真实网络生成包、做类型检查、通过它读数、并关闭一次真实交互 —— 不显式要求就自动跳过：

```bash
BKN_E2E=1 BKN_E2E_KN=ecommerce_ops_bkn_public BKN_BASE_URL=https://your-platform \
  python -m pytest tests/e2e -q
```

`BKN_E2E_OBJECT_TYPE` 指定被测的类；不给就自动挑一个有数据、且有关系可走的类。凭据的解析和任何调用方一样，所以 `openbkn auth login` 就够了。**建议对多个部署各跑一遍**：这个 SDK 依托开发的两台在路由名、指标、以及各自数据资源能服务哪些读上都出现过分歧。

### 函数内部调用的 Trace 父操作

沙箱同时注入会话、交互 ID 和 `BKN_PARENT_OPERATION_ID` 时，内部读取会将父 ID
作为 `bkn_context.parent_operation_id` 传递。每次读取仍保留自己的操作与回执。
显式切换到其他交互时不继承原父 ID；业务函数不需要增加参数。
