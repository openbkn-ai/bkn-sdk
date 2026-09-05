# osdk — Python 里读知识网络

CLI 一条命令回答一个问题。**要在一次推理里反复取数、把结果喂给下一步**，
就换 Python：`bkn-osdk` 是同一个平台的 Python SDK，和 `openbkn` 打同一套后端、
用同一份 `~/.bkn` 凭据。

## 什么时候用它，什么时候别用

| 你要做的 | 用什么 |
|---|---|
| 看一眼、改一下、发布一次 | `openbkn`（本 skill 其余部分） |
| 一次问答里取数 5 次、每次依赖上一次的结果 | **Python** |
| 沙箱里 `run_code` / `function run` 的代码要读知识网络 | **Python**（镜像里可直接 import） |
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
openbkn -k auth login https://your-platform -u <user> -p <pass>   # 凭据 store 归 CLI 管
bkn-osdk generate <kn-id> --out ./bkn                             # 生成本体层
```

**钉 commit，不要钉分支**：pip 的 wheel 缓存按 URL 命中，同一分支重建会装回旧构建、
报成功。装完 `direct_url.json` 里记着实际落地的 commit。

凭据解析由内向外：`session(...)` → `configure(...)` → `BKN_TOKEN`/`BKN_BASE_URL` →
`~/.bkn`（`openbkn auth login` 写的那份，**只有这条能自动刷新**）。

## 沙箱里（agent 最常落地的地方）

`run_code` / `function run` 的代码里：

```python
import bkn_osdk
bkn_osdk.configure(base_url="https://your-platform", insecure=True)   # 这一行必须有
from bkn_osdk import kn
kn.query_object_instance(KN_ID, "order", limit=10, response_format="json")
```

沙箱里 `BKN_TOKEN`、`BKN_CONVERSATION_ID`、`BKN_INTERACTION_ID` 由平台注入，
**但没有 `BKN_BASE_URL`，也没有 `~/.bkn`** —— 所以平台地址要自己点名，其余不用传。

**turn 会自动继承**：调用方在 `/function/execute` 的 body 里传了那两个 id，
沙箱里的读就挂在宿主那次交互上，证据链是一条而不是两条。经 MCP 的 `run_code`
拿不到这两个 id（实测两个变量都是空的）。

## 三件容易踩的

**1. 聚合不在对象集上。** 没有 `sum()` / `group_by()`，因为平台没有这个端点。
聚合走指标（`bkn.Gmv.query(...)`）或 `kn.run_sql(...)`；后者表名写
`{{.<resource_id>}}` 占位符，resource_id 从 `kn.search_schema(..., include_columns=True)`
的 `data_source.id` 取，**不是物理表名**。

**2. 能力面必须带 turn，读路径不用。** MCP 工具与 `/kn/` REST 拒绝无上下文调用；
`ontology-query` 的实例/子图/指标不拒。SDK 自动处理这个差别 —— `kn.*` 和
`search()` 第一次就带上，类型化读先裸发。手写 `call_tool` 时才需要自己
`ensure_interaction(ctx, kn_id)` 拿 `bkn_context`。

**3. `== None` 不是过滤。** 平台回 400；缺失有自己的算子：`.exists()` / `.not_exists()`。

## 出错怎么读

| 症状 | 多半是 |
|---|---|
| `Public.NotFound: 对象不存在` 但类型明明在 | 参数放错位置 —— 有三条路由的 `kn_id`/`ot_id` 走 query 不走 body（用 `kn.*` 就不会踩） |
| `ObjectTypeNotFound` 调 `find_skills` 时 | 这个网络没绑技能，不是对象类不存在 |
| `未绑定数据源` | 该对象类只有 schema 没有数据 |
| `conversation_required` | 少了 turn，见上面第 2 条 |
| `trace_core_unavailable` | 平台 Trace Core 挂了，需要 turn 的调用全停，类型化读不受影响 |

## 更细的

包内文档：[python/README.md](https://github.com/openbkn-ai/bkn-sdk/blob/main/python/README.md)
（[中文](https://github.com/openbkn-ai/bkn-sdk/blob/main/python/README.zh.md)）。
十个能跑的例子在 [python/examples/](https://github.com/openbkn-ai/bkn-sdk/tree/main/python/examples)，
按层分在 `ontology/` 与 `platform/` 两个目录里。
