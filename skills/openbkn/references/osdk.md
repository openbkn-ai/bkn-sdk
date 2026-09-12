# osdk — Python 里读知识网络

CLI 一条命令回答一个问题。**要在一次推理里反复取数、把结果喂给下一步**，
就换 Python：`bkn-osdk` 是同一个平台的 Python SDK，和 `openbkn` 打同一套后端、
用同一份 `~/.bkn` 凭据。

## 什么时候用它，什么时候别用

| 你要做的 | 用什么 |
|---|---|
| 看一眼、改一下、发布一次 | `openbkn`（本 skill 其余部分） |
| 一次问答里取数 5 次、每次依赖上一次的结果 | **Python**，挂在本轮 turn 上（见「业务问答里」） |
| 沙箱里 `run_code` / `function run` 的代码要读知识网络 | **Python**（0.1.5 起镜像预装，见「沙箱里」） |
| 写脚本、笔记本、离线分析 | **Python** |
| 组织 / 用户 / 角色 / 建网 / 发布 | `openbkn`（SDK 是只读的） |

## 两层，按"寻址什么"分

```python
import bkn_osdk

# 平台层：平台自己 —— 任意 REST 路由、任意工具
bkn_osdk.call("/api/agent-observability/v1/traces", query={"limit": 10})
bkn_osdk.tool_catalog(bkn_osdk.resolve_context())      # 这个部署公布了什么
from bkn_osdk import kn
kn.run_sql(KN_ID, "SELECT COUNT(*) AS n FROM {{.<resource_id>}}")

# 本体层：某个知识网络的本体 —— 从它的 schema 生成的类
import bkn
bkn.Order.where(bkn.Order.total_amount > 100).order_by(bkn.Order.created_at.desc()).take(10)
```

本体层只读、有类型。平台层什么都能打，代价是参数形状要自己按 catalog 对。

## 装 + 指平台

```bash
pip install "bkn-osdk @ git+https://github.com/openbkn-ai/bkn-sdk@<sha>#subdirectory=python"
# 没有 git 的环境改用归档地址，fragment 不变：
pip install "bkn-osdk @ https://github.com/openbkn-ai/bkn-sdk/archive/<sha>.zip#subdirectory=python"

openbkn -k auth login https://your-platform -u <user> -p <pass>   # 凭据 store 归 CLI 管
bkn-osdk generate <kn-id> --out ./bkn                             # 生成本体层
```

**钉 commit，不要钉分支**：pip 的 wheel 缓存按 URL 命中，同一分支重建会装回旧构建、
报成功。装完 `direct_url.json` 里记着实际落地的 commit。

凭据解析由内向外：`session(...)` → `configure(...)` → `BKN_TOKEN`/`BKN_BASE_URL` →
`~/.bkn`（`openbkn auth login` 写的那份，**只有这条能自动刷新**）。

## 业务问答里：挂在本轮 turn 上

本 skill 开头的受管硬门禁同样约束 Python：业务问答里的每一次读取，都要挂在
`bkn_start_interaction` 返回的那个 turn 上。不交 turn 时 SDK 不报错，但读取会脱离它：
类型化读直接裸发到 `ontology-query`，`kn.*` 与 `search()` 各自另开一个短命 interaction。
只写 `traced=True` 也不够，作用域同样会另开一个。

把 start 返回的两个 ID 连同 `traced=True` 一起交给作用域：

```python
with bkn_osdk.session(traced=True, conversation_id=cid, interaction_id=iid):
    paid = bkn.Order.where(bkn.Order.status == "paid").take(50)   # 经 Context Loader 的 MCP 工具
    kn.run_sql(KN_ID, "SELECT ...")                                 # 带同一个 bkn_context
```

- 作用域加入这个 turn，不另开，也**不会替你 finish**；本轮照常以 `bkn_finish_interaction` 收尾。
- `traced=True` 让类型化读改走 Context Loader 的 MCP 工具。带 `order_by` 或要总数
  （`.count()`）的查询仍走 REST，因为那个工具不认 `sort` / `need_total`，但请求带着同一个 turn。
- 出错按硬门禁停下、原样报错，不要去掉 turn 重试。

## 沙箱里（agent 最常落地的地方）

0.1.5 起，沙箱模板镜像预装 `bkn-osdk`，平台为每次执行注入 `BKN_BASE_URL`（集群内地址）、
`BKN_TOKEN`、`BKN_CONVERSATION_ID`、`BKN_INTERACTION_ID`。代码里什么都不用配：

```python
from bkn_osdk import kn
kn.query_object_instance(KN_ID, "order", limit=10, response_format="json")
```

- **不要 `configure(base_url=...)` 指向网关地址。** 注入的是集群内地址，沙箱在集群内访问不到
  网关，覆盖后调用在网络层失败。
- 报 `No base URL`，说明该部署的沙箱 chart 里 `BKN_BASE_URL` 与 `BKN_SANDBOX_MCP_URL` 都没配。
  让部署方补上集群内 agent-retrieval 地址，不要在代码里写死。
- **turn 会自动继承。** 调用方在 `/function/execute` 的请求体里传了 `bkn_conversation_id` /
  `bkn_interaction_id`，沙箱里的读就挂在宿主那次交互上，证据链是一条而不是两条。
- 经 MCP 的 `run_code` 不把这两个 ID 放进环境变量（实测为空）。脚本里用 `bkn-osdk` 读业务数据时，
  把本轮的两个 ID 按上一节写进 `session()`。
- **0.1.4 及更早**：镜像不带 `bkn-osdk`，镜像里也没有 git。这些版本的沙箱代码用内建的
  `sandbox_sdk.bkn`，见 [function.md](function.md)。

写成可发布的函数工具，走 [create-skill](../../create-skill/SKILL.md) 技能。

## 三件容易踩的

**1. 聚合不在对象集上。** 没有 `sum()` / `group_by()`，因为平台没有这个端点。
聚合走指标（`bkn.Gmv.query(...)`）或 `kn.run_sql(...)`；后者表名写
`{{.<resource_id>}}` 占位符，resource_id 从 `kn.search_schema(..., include_columns=True)`
的 `data_source.id` 取，**不是物理表名**。

**2. 能力面必须带 turn，读路径不用。** MCP 工具与 `/kn/` REST 拒绝无上下文调用；
`ontology-query` 的实例/子图/指标不拒。没有 turn 时 SDK 自己补：`kn.*` 和 `search()`
开一个短命 interaction，类型化读先裸发。业务问答里不要依赖这个补法，按上文把本轮 turn
交给 `session()`。手写 `call_tool` 时要自己 `ensure_interaction(ctx, kn_id)` 拿 `bkn_context`。

**3. `== None` 不是过滤。** 平台回 400；缺失有自己的算子：`.exists()` / `.not_exists()`。

## 出错怎么读

| 症状 | 多半是 |
|---|---|
| `Public.NotFound: 对象不存在` 但类型明明在 | 参数放错位置 —— 有三条路由的 `kn_id`/`ot_id` 走 query 不走 body（用 `kn.*` 就不会踩） |
| `未绑定数据源` | 该对象类只有 schema 没有数据 |
| `conversation_required` | 少了 turn，见「业务问答里」 |
| `No base URL`（沙箱里） | 部署没配沙箱的 BKN 地址，见「沙箱里」 |
| `trace_core_unavailable` | 平台 Trace Core 不可用，需要 turn 的调用全部失败；业务问答里按硬门禁停下，不要改用裸读绕过 |

## 更细的

包内文档：[python/README.md](https://github.com/openbkn-ai/bkn-sdk/blob/main/python/README.md)
（[中文](https://github.com/openbkn-ai/bkn-sdk/blob/main/python/README.zh.md)）。
能跑的例子在 [python/examples/](https://github.com/openbkn-ai/bkn-sdk/tree/main/python/examples)，
按层分在 `ontology/` 与 `platform/` 两个目录里。
