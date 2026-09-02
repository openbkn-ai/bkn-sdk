# 把 Python OSDK 烘进沙箱镜像

> 交给 `openbkn-ai/bkn-foundry` 的改动说明
> 起因：`openbkn-ai/bkn-sdk#86` 已合入 main（`00e128e`），Python OSDK 可用
> 验证日期：2026-09-02，`10.211.55.4` 与 `14.103.77.23`

## 一句话

沙箱里的 Python 代码现在要读知识网络，只能在运行时 `pip install` 一次（25–30 秒，且要求沙箱能出网到 github.com）。把它烘进模板镜像，这两个代价都消失，无出网部署也能用。

## 改什么

一个文件，一行依赖：

**`infra/sandbox/images/templates/executor/common-requirements.txt`**

```diff
 # --- Common: high-frequency, lightweight helpers ---
 python-dateutil==2.9.0.post0
 pytz==2024.2
 pydantic==2.9.2
 PyYAML==6.0.2
 jsonschema==4.23.0
 requests==2.32.3
 httpx==0.27.2
+
+# --- BKN: 平台自己的 Python SDK ---
+# 未发 PyPI，所以用归档地址按 commit 钉版本（沙箱镜像里没有 git，
+# `git+https://` 装不上）。运行时依赖只有上面已有的 httpx。
+# 升级方式：把 sha 换成 bkn-sdk main 上的新 commit，重建镜像。
+bkn-osdk @ https://github.com/openbkn-ai/bkn-sdk/archive/00e128e.zip#subdirectory=python
```

## 为什么是这个文件

`common-requirements.txt` 已经在做需要的事 —— 镜像构建时 `pip install --target /opt/sandbox-common`，而那个目录：

- 在 `PYTHONPATH` 里（`…:/opt/sandbox-sdk:/opt/sandbox-common`）
- **扛得过依赖同步**：`/opt/sandbox-venv` 每次同步被清空，这个不会
- 排在依赖目录之后，所以函数自己声明的依赖仍然覆盖基线版本

该文件头部的注释本来就写着这次要解决的问题：

> 避免 per-session pip installs，并且在无出网部署下也能工作（那种环境里运行时 pip 连不上互联网）

## 已验证

| 事项 | 结果 |
| --- | --- |
| `pip install --target <dir>` 装 bkn-osdk | 成功，**532K** |
| 装进去的内容 | 23 个能力函数（`bkn_osdk.kn.*`）+ `call` / `call_tool` / `tool_catalog` |
| 运行时依赖 | 只有 `httpx`，而 `httpx==0.27.2` 已在该文件里 —— 正是 SDK 支持范围的下限，其 CI 有专门的 floor job 跑它 |
| 在真实沙箱里跑（VM，运行时安装的方式） | 平台层全部通过：`get_kn_detail`、`search_schema`、`describe_resource`、`run_sql`、`query_object_instance`、`list_resources`、`list_skills`、裸 REST `call`、`call_tool` 带回执 |
| 宿主 turn 继承 | **通过** —— 沙箱里解析出的 `interaction_id` 等于发起 `/function/execute` 的那次交互 |

## 三个要决定的

### 1. 哪些模板

`build.sh` 的 `PREINSTALL_COMMON_TEMPLATES` 目前只有 `python-basic`，`multi-language` 刻意保持精简。

建议：**先只进 `python-basic`**。SDK 只有 532K，但 `multi-language` 的取舍是你们定的，不该由这个改动顺手改掉。

### 2. 钉哪个 commit

上面用的是 `00e128e`（#86 合入 main 的 squash commit）。

**必须钉 commit，不要钉分支名。** 实测过：pip 的 wheel 缓存按 URL 命中，对同一分支重建时 pip 会报成功却装回缓存里的旧构建，`direct_url.json` 里留着上一个 commit。钉 sha 没有这个问题。

### 3. 要不要顺便注入 `BKN_BASE_URL`（另一个改动）

沙箱里实测能看到的环境变量：

| 变量 | 有没有 | 说明 |
| --- | --- | --- |
| `BKN_TOKEN` | 有 | 调用方在 `/function/execute` body 里传的 `bkn_token` |
| `BKN_CONVERSATION_ID` / `BKN_INTERACTION_ID` | 看调用方 | body 里传了才有值；不传则变量在但是空串 |
| `user_id` | 有 | 小写 |
| `BKN_SANDBOX_MCP_URL` | 有 | 集群内地址，如 `http://agent-retrieval:30779` |
| **`BKN_BASE_URL`** | **没有** | 所以 SDK 解析不出平台地址 |

后果：即使 SDK 预装好，用户代码仍要写一行

```python
bkn_osdk.configure(base_url="https://your-platform", insecure=True)
```

如果 execution-factory 把平台地址也注进执行环境，沙箱里就是**零配置**：token、turn、平台地址全从环境来，用户代码第一行就是 `import bkn`。

这是独立的一个改动，不阻塞上面那行依赖。

## 改完之后 SDK 侧会做什么

`bkn-sdk` 的 [`python/examples/platform/sandbox.py`](https://github.com/openbkn-ai/bkn-sdk/blob/main/python/examples/platform/sandbox.py) 现在演示的是"运行时装一次再用"。镜像烘好之后那一步就是多余的，我们会把它改成直接 `import bkn_osdk`，并在文档里说明镜像自带。

在那之前运行时安装仍然可用（沙箱能出网时），所以两边不需要同步发布。

## 联系

改动来源：`openbkn-ai/bkn-sdk#86`。沙箱内的验证脚本与完整输出可向该仓库索取。
