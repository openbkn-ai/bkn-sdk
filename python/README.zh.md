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

从 PyPI 安装。版本号跟随发布它的 SDK 版本，写成 PEP 440 形式（`v0.2.1-rc.2` 即 `0.2.1rc2`）；预发布版本须钉版本号或加 `--pre`，pip 才会装：

```bash
pip install "bkn-osdk==0.2.1"
```

唯一依赖是 `httpx`，所以镜像构建就一行：

```dockerfile
RUN pip install --no-cache-dir "bkn-osdk==0.2.1"
```

生成的业务包会声明它所针对的运行时小版本线（`REQUIRES_RUNTIME`，默认 `>=0.2,<0.3`），不在范围内就拒绝导入。早先 `0.1.0` 运行时生成的包声明的是 `>=0.1,<0.2`，升级时需用本运行时重新生成。

要装尚未发布的 commit，包在本仓库的子目录里，pip 可以直接寻址：

```bash
pip install "bkn-osdk @ git+https://github.com/openbkn-ai/bkn-sdk@<sha>#subdirectory=python"
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

## 让用户登录你的应用

替用户办事的应用，每个用户都需要一份 OAuth token，并且得让它一直有效。`bkn_osdk.oauth` 负责登录（PKCE、回环回调、换取 code）和刷新；`configure` / `session` 会像刷新 store 里的会话那样刷新它返回的 token：

```python
import bkn_osdk
from bkn_osdk import oauth

# 一次性：为应用注册一个公开客户端（或者找运维要一个）。
client = oauth.register_client(PLATFORM, "My app")

# CLI、桌面应用、脚本、笔记本：打开浏览器，在
# http://127.0.0.1:8765/callback 上等回调，再换 code。
tokens = oauth.login(PLATFORM, client_id=client.client_id)
save(tokens.to_dict())  # 一定要存下来，见下面的注意事项

bkn_osdk.configure(
    base_url=PLATFORM,
    tokens=tokens,
    client_id=client.client_id,  # 刷新必须报出签发这批 token 的客户端
    on_refresh=lambda fresh: save(fresh.to_dict()),
)
People.take(10)  # 过期前不久和遇到 401 时自动刷新
```

多用户的服务端则为每个请求绑定各自的 token；作用域存在 `ContextVar` 里，一个用户的 token 不会漏进另一个用户的请求：

```python
with bkn_osdk.session(tokens=tokens_for(user), client_id=CLIENT_ID, on_refresh=save_for(user)):
    People.take(10)
```

Web 应用在自己的处理器里接收回调。把 `AuthorizationRequest`（里面有 `state` 和 PKCE verifier）存在该用户的服务端会话里：

```python
req = oauth.authorization_request(PLATFORM, CLIENT_ID, redirect_uri="https://app.example/cb")
# 把浏览器重定向到 req.url；之后在 /cb 处理器里：
tokens = oauth.exchange_code(PLATFORM, req, code=params["code"], state=params["state"])
```

没有浏览器的机器用 `oauth.device_login(PLATFORM)`：它打印一个验证码，到别处批准即可（传 `on_prompt` 可自己展示）。它以 CLI 的 `openbkn-sdk` 客户端登录，这也正是 `configure` 里 `client_id` 的默认值。`oauth.refresh(PLATFORM, tokens, client_id=…)` 是单独的刷新授权。没有登录成功时会抛 `AuthError`，带 `error` 和 `description`。

四件要知道的事：

1. **每次回调拿到的 refresh token 都要存。** 每次刷新都会花掉旧的、签发新的；`on_refresh` 收到的是完整的新一套。只留了第一份的应用，下次启动就得让用户重新登录。
2. **不要在两个进程里刷新同一个用户的 token。** 平台把被重复使用的 refresh token 当作被盗，会吊销整条链，用户在所有地方都被登出。一个进程里是安全的（并发请求共用一次刷新）；多个实例需要带锁的共享存储，或者只让一个地方负责刷新。
3. **刷新失败就是要重新登录。** refresh token 过期、被吊销，或用户在「已连接的客户端」里断开了这个应用。此时请求会带着原来的 401 和相应提示失败。
4. **`login` 只处理回环回调。** Web 应用在自己的处理器里用 `authorization_request` + `exchange_code`，并且需要运维为该客户端放行非回环的回调域名。平台没有自助注册时（0.2.0 没有，也可能被关闭），`register_client` 会抛 `AuthError`：改用 `device_login`，或找运维。

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

for order in Order.iterate(page_size=500):  # 游标翻页；旧部署回退到 limit/offset
    ...

page = Order.objects().page(limit=100)
next_page = Order.objects().page(limit=100, cursor=page.next_cursor)  # 末页为 None
```

当前 ontology-query 契约使用不透明游标翻页：把响应里的 `paging.next_cursor` 作为 `cursor` 连同同一查询回传，末页为 `null`。在此之前构建的部署（现网的 0.1.5）不返回 `paging`，但支持 `offset`，所以 `iterate()` 在首个响应带游标时沿游标翻页，否则回退到 `limit`/`offset`，遇到短页即停止。`page(offset=...)` 仍照常发送 `offset`；同时传 `offset` 和 `cursor` 会报错。

`~` 在平台表达得了的地方对条件取反：比较运算符互相反转，`in` / `like` / `exist` 各有配对的否定式，`and` / `or` 按德摩根律取反。`match` 和 `knn` 在算子枚举里没有对立面，所以对它们用 `~` 会直接报错，而不是现编一个。

`Order.total_amount` 是用来构造条件的 `PropertyRef`，`order.total_amount` 是一个 `Decimal`。同一个名字，两件事 —— 而且都有类型，所以 `People.age > 30` 能通过检查，`People.name > 30` 不能。

解码按声明的类型走：`decimal` 以 JSON 字符串到达并变成精确的 `Decimal`，`datetime` 保留时区偏移。查询没返回的属性会报错，而不是读成 `None`。

平台的过滤语法有三件事值得知道，都在真实部署上验过：

- `like` 的语义属于**背后的数据资源**，实测两个部署的行为不同：Postgres 支撑的对象类把值当普通子串（`like("2026")` 命中，`like("2026%")` 不中），Vega catalog 支撑的当 SQL 模式（`like("%FIFA%")` 命中，`like("FIFA")` 不中）。值是逐字发出去的，猜错返回零行而不是报错，所以拿你自己的对象类两种都试一下。
- `match` 在算子枚举里，但 Postgres 支撑的对象类会 500。
- `limit` 取值 1–10000，且**零命中时 `total_count` 整个字段不出现**。

## 聚合

对象集上没有 `sum()` 或 `group_by()`，因为平台没有对应的端点：实例查询接受条件、排序、limit、cursor（或 offset）和属性选择，`need_total` 给行数。把所有行拉回本地再聚合，是把谎言包装成 API。

平台的聚合面是已发布、带版本的**对象指标 V1**。生成类固定引用已发布版本，只开放定义允许的运行时选择：

```python
from bkn.metrics import Gmv

Gmv.query(
    time={"start": 1751328000000, "end": 1753920000000},  # Unix 毫秒
    group_by=["channel_id"],
)
```

`Gmv.__version__` 与 `Gmv.__dimensions__` 来自已发布定义；未声明或有歧义的维度会在请求前被拒绝。`start` / `end` 须为 Unix 毫秒整数；不再接受旧版 `instant` 和 `step`。`analysis_dimensions` 仍作为兼容参数保留，但两种写法在线路上都发送规范字段 `group_by`。

没有交互上下文时，传输是裸的 ontology-query 请求 `POST …/object-metrics/{metric_id}/data?version=N`。在 `session(traced=True)` 中，或 context 已经携带 conversation / interaction ID 时，改走 Context Loader 托管的 `query_metric` 工具：查询字段与生成包的 branch 原样透传，托管响应归一成同一份 V1 `model`、`entries`、`status`、`warnings` 包络，并把回执累积到交互上。生命周期 `bkn_context` 绝不会塞进 ontology-query 的严格请求体。固定业务限定与统计粒度由指标定义决定，查询不能覆盖。

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

`session(traced=True)` 下的读走 MCP，落在一个受管交互里 —— 第一次读时打开，之后复用，退出时关闭 —— 并带回执：状态、证据持久性、证据引用、精确到属性粒度的业务引用。这是 foundry #1417 之后已完成调用携带的精简回执；完整记录留在 Core，用 `openbkn trace interactions operations <interaction-id>` 读取。状态为 `failed` 的回执抛 `ToolError("receipt_failed")`；`pending` 的回执不带值返回。

```python
with bkn_osdk.session(traced=True):
    page = Order.objects().page(limit=10)
    page.receipt["receipt_status"]
    page.rows[0].__receipt__  # 同一份回执，挂在它所解释的每一行上
```

`order_by` 以 `sort` 发给工具。工具不接受 `need_total`、REST 的 cursor 和 REST 查询参数（`options(...)`），需要其中任一个的查询**即使在 traced 作用域里也走 REST** —— 带着该作用域的 turn，所以照样被记录，只是拿不到随包回执。不带 traced 的读全程走 REST，更快，不带回执。

**哪些调用需要 turn，取决于"面"，不取决于工具。** 能力面 —— MCP 工具和它们在 `/kn/` 下的 REST 孪生 —— 拒绝没有上下文的调用：catalog 里除两个生命周期工具外，每个都把 `bkn_context` 标成 required。所以 `search`、`search_instances` 以及任何直接的 `call_tool` 第一次就带上 turn：作用域里有就用它的，没有就开一个短命的。`ontology-query` 下的实例、子图读路由，以及未跟踪的指标读，接受裸请求且不会凭空造 turn。已经有 turn 的指标读会明确走 Context Loader 托管工具；不会再把 `bkn_context` 加进严格的 ontology-query 请求体后重试。

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

### 当前调用者是谁

`me()` 返回当前凭据所属用户的资料，实时从 bkn-safe 读取：

```python
user = bkn_osdk.me()
user.id, user.account, user.name, user.email, user.telephone
user.departments, user.roles  # 部门 id；角色名
```

在函数里，凭据就是调用方本人的，所以 `me()` 返回的是运行这个函数的人 —— 行动背后的函数，就是触发行动的人。它是一次经 `BKN_BASE_URL` 的 REST 调用。沙箱里这个地址为空时，会和其他 OSDK 调用一样直接抛出 `InputError`（"No base URL"），不会发出请求；地址配了但沙箱网络没放行网关时，会报连接错误。

### 能力路由的命名函数

context-loader 那一圈 —— `/api/agent-retrieval/v1/kn/` 下的 25 条路由 —— 也是生成的，源头是 foundry 自己的 OpenAPI：

```python
from bkn_osdk import kn

kn.list_resources(KN_ID)
kn.run_sql(KN_ID, "SELECT COUNT(*) AS n FROM {{d9hff…}}")
kn.run_cypher(
    KN_ID,
    "MATCH (o:order)-[:rel_order_customer]->(c:customer) RETURN c.city AS city, count(*) AS n",
)
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

写入与行动执行、对象集上的聚合（没有对应端点，见上）、catalog 里只走 MCP 的那些工具的类型化包装 —— 生命周期两条与沙箱工具，目前只能通过 `call_tool` 触达 —— 异步客户端，以及从本地 `.bkn` 目录离线生成。每一项在[设计文档](../docs/superpowers/specs/2026-08-11-python-osdk-design.md)里都有一节，写明它落地时会长成什么样。

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
