# BKN 规范 3.0 / 2.x（LLM 生成用）

你负责生成符合 BKN 格式的知识网络目录，供业务知识网络建模使用。默认写 3.0；要写 2.x 时按「[2.x 规范写法](#2x-规范写法)」。

本文是 bkn-foundry `adp/bkn/bkn-backend/server/bkn-specification/SPECIFICATION.md`（3.0.0）的生成用摘要，
只写 3.0 的唯一写法，最后一节说明 2.x 写法。两者不一致时以 foundry 的规范为准。

## 规范版本

`network.bkn` 的 frontmatter 写 `bkn_spec: "3.0"`，整个包按 3.0 读取。不写时按 2.x 读取，本文的
属性声明、值类型、别名、关系声明与生命周期**全部被忽略**。

- 3.0 需要 0.2.1 及以上的平台；0.2.0 平台只读 2.x。用 `openbkn --version` 确认目标平台：CLI 只连与自己同版本的平台。
- 用户要求 2.x，或目标平台只读 2.x 时，按「[2.x 规范写法](#2x-规范写法)」写。
- 3.0 **每样东西只有一种写法**：未列出的 frontmatter 字段、未知的 `###` 小节、未知或重复的表格列、
  旧列名、同义写法都会被拒绝导入，错误信息会指出文件与位置。只按本文写。

## 目录结构

```
{network_dir}/
├── network.bkn              # 必需，根文件
├── SKILL.md                 # 可选，给 Agent 的网络导读
├── CHECKSUM                 # 可选；导出时生成，不要手写；改了文件就删掉
├── value_types/             # 值类型
├── object_types/            # 对象类
├── relation_types/          # 关系类
├── action_types/            # 行动类
├── risk_types/              # 风险类
└── concept_groups/          # 概念分组
```

- 一个定义一个文件，文件名 `{id}.bkn`。定义的类型由所在子目录决定，frontmatter 的 `type` 必须与子目录一致。
- 子目录外的 `.bkn` 文件与其他目录被忽略；实例数据不属于 BKN 包，数据由资源提供。

## 文件结构

每个 `.bkn` 文件 = YAML frontmatter（`---` 包裹）+ Markdown 正文，UTF-8。

| 标题层级 | 用途 |
|----------|------|
| `#` | 网络标题，仅 `network.bkn` |
| `##` | 定义标题：`## {前缀}: {name}`，`name` 与 frontmatter 相同 |
| `###` | 定义内的小节，标题必须与本文完全一致（区分大小写） |
| `####` | 逻辑属性名 |

- **描述**：`##` 标题之后、第一个 `###` 之前的文字（网络是 `#` 之后、第一个 `##` 之前）。描述里以 `#` 开头的行写作 `\#`。
- **表格**：列名只用本文列出的英文写法，每列至多一次，列顺序不限；必须有分隔行；每行以 `|` 开头和结尾；
  单元格内的竖线写作 `\|`，换行写作 `<br>`。每个小节至多一张表。
- **YAML 块**：写在 ```` ```yaml ```` 代码块中，每个小节至多一个，必须是合法 YAML。
- 只取一行的表：`Data Source`、`Endpoint`、`Backing Resource`、`Bound Object`、`Action Source`、`Schedule` 只写一行数据。

## 通用 frontmatter 与命名

| 字段 | 必需 | 规则 |
|------|:----:|------|
| `type` | 是 | 见各类型；与子目录一致 |
| `id` | 是 | `^[a-z0-9][a-z0-9_-]{0,127}$`，网络内同类型唯一 |
| `name` | 是 | 非空，最长 128 字符；对象类、行动类、风险类、概念分组、值类型的 `name` 网络内不得重复（关系类可以重复） |
| `tags` | 否 | YAML 列表，最多 5 个，每个最长 40 字符，不含 `/ : ? \ " < > \| , # [ ] { } % & * $ ^ ! = . '` 及中文标点 |

- 属性名（`Name` 列）：`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$`。
- 只写本文为该类型列出的字段，其他字段拒绝。

### 生命周期 `lifecycle`

对象类、关系类、行动类的 frontmatter 可写：

```yaml
lifecycle:
  status: deprecated               # active | deprecated；不写即 active，active 不要写出来
  reason: 改用「开单医生」          # deprecated 时必填
  replaced_by: order_by_doctor     # 可选，同类型、非 deprecated 的另一个定义 ID
```

- `deprecated` 的定义默认不进概念召回，按 ID 仍可查询。
- 端点对象类为 `deprecated` 时，关系类也必须是 `deprecated`。
- 仍被 `replaced_by` 或 `fallback_for` 指向的定义不能改为 `deprecated`。
- 名称只写业务含义，不写「【核心】」「【待确认】」一类状态前缀：用 `lifecycle`、`importance`、`verification` 表达。

## 网络（network.bkn）

```markdown
---
type: knowledge_network
id: clinic_lab
name: 门诊检验
tags: [医疗]
bkn_spec: "3.0"
---

# 门诊检验

门诊检验申请，以及相关的患者、医生与科室。
```

| 字段 | 说明 |
|------|------|
| `bkn_spec` | 写 `"3.0"` |
| `version`、`branch` | 可选，原样保存 |
| `capabilities` | 可选，挂载的 Skill / 工具 / MCP 工具 / 知识库声明，见下文 |

正文只写 `# {name}` 与网络描述。`## Network Overview`、`## Directory Structure` 由导出器生成，手写无效，不要写。

## 值类型（value_types/*.bkn）

「基础类型 + 一组约束」的命名定义，供多个属性复用。作用范围是单个网络，平台不预置。

````markdown
---
type: value_type
id: lis_apply_status
name: LIS 检验申请状态
tags: [检验]
---

## ValueType: LIS 检验申请状态

LIS 系统的检验申请状态码。X 是旧系统的撤销编码，存量数据中仍存在。

### Definition

```yaml
base_type: keyword
enum:
  - { value: N, display: 已开单 }
  - { value: C, display: 已撤销 }
  - { value: X, display: 已撤销, deprecated: true }
```
````

唯一的小节是 `### Definition`（YAML）：

| 键 | 说明 |
|----|------|
| `base_type` | 必需：`string`、`keyword`、`integer`、`unsigned integer`、`float`、`decimal`、`date`、`datetime`、`timestamp` |
| `enum` | 枚举项列表：`value`（必需，符合 `base_type`，不重复）、`display`（必需，可重复，用于新旧编码并存）、`deprecated`（可选，停用的旧编码）、`description`（可选） |
| `range` | 闭区间 `{ min, max }`，可只写一个；数值类写数字，日期时间类写 ISO 8601 字符串 |
| `length` | 字符数闭区间，用于字符串类 |
| `pattern` | RE2 正则，用于字符串类；YAML 中用双引号并转义反斜杠，如 `"^\\d{17}[\\dX]$"` |
| `unit` | 单位，自由文本 |

- 三种常见用途：**枚举**（`enum`）、**格式**（`length` / `pattern`）、**区间**（`range` / `unit`）。
- 有 `enum` 时不能再写 `range`、`length`、`pattern`；`unit` 可以同时出现。
- 停用的旧编码保留在枚举里并标 `deprecated: true`：存量数据仍有，按含义筛选时要一起带上。

## 对象类（object_types/*.bkn）

````markdown
---
type: object_type
id: lab_order
name: 检验申请
aliases: [化验单, 检验单]
tags: [检验]
---

## ObjectType: 检验申请

{描述：对象是什么、类型级业务规则}

### Data Source

| Type | ID | Name |
|------|----|------|
| resource | res_lab_order | 检验申请表 |

### Data Properties

| Name | Display Name | Type | Semantic | Required | Aliases | Description | Mapped Field |
|------|--------------|------|----------|----------|---------|-------------|--------------|
| order_no | 申请单号 | string | | | 条码号 | 主键 | order_no |
| ordered_at | 开单时间 | datetime | event_time | true | 申请时间 | | apply_time |
| status | 申请状态 | keyword | status | true | | | apply_status |
| fee | 费用 | decimal | | | 检验费 | | fee_amount |
| updated_at | 更新时间 | datetime | | | | | updated_at |

### Property Constraints

```yaml
order_no:
  pattern: "^LO\\d{10}$"
  unique: true
ordered_at:
  timezone: Asia/Shanghai
status:
  value_type: lis_apply_status
fee:
  value_type: amount_cny
```

### Logic Properties

### Keys

Primary Keys: order_no
Display Key: order_no
Incremental Key: updated_at
````

小节：`Data Source`（可选）、`Data Properties`（必需）、`Property Constraints`（可选）、`Logic Properties`（可选，可留空小节）、`Keys`（必需）。

frontmatter 另可写 `aliases`（别名列表，见「别名」）与 `lifecycle`。

### Data Source

`Type` 固定 `resource`；`ID` 是 Vega 资源 ID（`openbkn bkn resources` / `openbkn vega resource list` 可查）；`Name` 仅供阅读。不绑定资源时省略整节。

### Data Properties

| 列 | 必需 | 说明 |
|----|:----:|------|
| `Name` | 是 | 属性名 |
| `Display Name` | 是 | 显示名，最长 40 字符 |
| `Type` | 否 | 数据类型，见下表 |
| `Semantic` | 否 | 业务语义，见下表；没有任何属性用到时整列省略 |
| `Required` | 否 | `true` 或空。主键视为必填，**主键留空**；不要写 `false` |
| `Aliases` | 否 | 属性别名，半角逗号分隔；没有任何属性用到时整列省略 |
| `Description` | 否 | 只写结构化声明表达不了的内容：业务口径、计算方式、注意事项；不重复语义、单位、枚举、必填 |
| `Mapped Field` | 否 | 资源中的字段名 |
| `Mask Rule` | 否 | 脱敏规则 JSON；没有任何属性用到时整列省略 |

列顺序按 `Name | Display Name | Type | Semantic | Required | Aliases | Description | Mapped Field | Mask Rule` 写。最多 1000 个属性。

数据类型（不区分大小写）：

| 类型 | 主键 | 显示键 | 增量键 |
|------|:----:|:------:|:------:|
| `string`、`text` | ✓ | ✓ | |
| `integer` | ✓ | ✓ | ✓ |
| `unsigned integer` | ✓ | ✓ | |
| `float`、`decimal`、`boolean`、`date`、`time` | | ✓ | |
| `datetime`、`timestamp` | | ✓ | ✓ |
| `keyword`、`json`、`binary`、`vector`、`point`、`shape`、`ip` | | | |

Semantic（每个取值在一个对象类中至多一次）：

| Semantic | 含义 | 允许的 Type | 规则 |
|----------|------|-------------|------|
| `event_time` | 事件发生时间 | `date`、`datetime`、`timestamp` | 有它的对象类即事件类 |
| `end_time` | 事件结束时间 | 同上 | 必须与 `event_time` 同时出现 |
| `valid_from` | 有效期开始 | 同上 | 可单独出现 |
| `valid_to` | 有效期结束；空值表示长期有效 | 同上 | 可单独出现 |
| `location` | 位置 | `point`、`shape` | 不能与 `latitude` / `longitude` 同时出现 |
| `latitude` / `longitude` | 纬度 / 经度 | `float`、`decimal` | 必须成对出现 |
| `status` | 当前状态 | `string`、`keyword`、`integer` | |
| `severity` | 严重程度 | `string`、`keyword`、`integer` | |

主键、显示名、增量时间由 `### Keys` 声明，单位由 `unit` 声明，都不另设 Semantic。

Mask Rule（`kind` 决定其余字段，JSON 中不写多余字段）：

| kind | 字段 | 适用 Type |
|------|------|-----------|
| `fixed` | `replacement` | `string`、`text`、`keyword` |
| `partial` | `keep_start`、`keep_end`、`replacement` | 同上 |
| `email` | `local_keep_start`、`preserve_domain`、`replacement` | 同上 |
| `round` | `step` | `integer`、`unsigned integer`、`float`、`decimal` |
| `date_granularity` | `granularity` | `date`、`time`、`datetime`、`timestamp` |

### Property Constraints

一个 YAML 块，键为数据属性名，属性按 Data Properties 表的顺序排列：

| 键 | 适用 Type | 含义 |
|----|-----------|------|
| `value_type` | 与值类型的 `base_type` 相同 | 引用本网络的值类型 |
| `range` | 数值类、`date`、`datetime`、`timestamp` | 闭区间，同值类型 |
| `length` | `string`、`keyword`、`text` | 字符数闭区间 |
| `pattern` | `string`、`keyword`、`text` | RE2 正则 |
| `unit` | 数值类 | 单位 |
| `unique` | 除 `json`、`binary`、`vector`、`point`、`shape` 外 | 主键之外的唯一性 |
| `crs` | Semantic 为 `location`、`latitude`、`longitude` | `wgs84`（GPS）、`gcj02`（高德、腾讯）、`bd09`（百度）；不写为未声明 |
| `timezone` | `datetime` | 不带时区的值按哪个时区解释，IANA 名称，如 `Asia/Shanghai` |

- **引用了值类型的属性不再写取值约束**：只能再写 `unique`、`crs`、`timezone`，写 `range`、`length`、`pattern`、`unit` 会被拒绝。需要不同规则时另建值类型。
- 一组编码（状态、类别、科室代码）用枚举值类型，不要把编码含义写在 Description 里。

### Keys

```
Primary Keys: {属性名}[, {属性名}...]    # 必需，至少一个，类型可作主键
Display Key: {属性名}                    # 必需，类型可作显示键
Incremental Key: {属性名}                # 可选，可留空，类型可作增量键
```

### Logic Properties

每个逻辑属性一个 `####` 子项，子项下用独占一行的粗体标签分隔四张表：

````markdown
### Logic Properties

#### lead_time_days

**Meta**

| Display Name | Type | Description |
|--------------|------|-------------|
| 交期天数 | tool | 按供应商计算交期 |

**Source**

| Source Type | Source ID | Source Name | BoxID | ToolID | ResultPath |
|-------------|-----------|-------------|-------|--------|------------|
| tool | | | box_supply | tool_lead_time | $.days |

**Parameters**

| Name | Type | Source | Operation | ValueFrom | Value | Description |
|------|------|--------|-----------|-----------|-------|-------------|
| supplier_id | string | Query | | property | supplier_id | 供应商 |
| as_of | string | Query | | input | | 查询日期 |

**Analysis Dimensions**

| Name | Display Name | Type | Description |
|------|--------------|------|-------------|
````

- **Meta**：`Type` 为 `metric` 或 `tool`。
- **Source**：`metric` 写 3 列 `Source Type | Source ID | Source Name`，`Source ID` 是指标 ID；`tool` 写 6 列，`BoxID`、`ToolID` 必填，`Source ID` 留空。
- **Parameters**：同行动类的 `Parameter Binding`；metric 参数的 `Source` 留空，`Operation` 写比较操作符。
- 不要写没有 `####` 的扁平表。

## 关系类（relation_types/*.bkn）

````markdown
---
type: relation_type
id: order_for_patient
name: 检验对象
reverse_name: 检验申请
verification: confirmed
---

## RelationType: 检验对象

### Endpoint

| Source | Target | Type | Cardinality |
|--------|--------|------|-------------|
| lab_order | patient | direct | many_to_one |

### Mapping Rules

| Source Property | Target Property |
|-----------------|-----------------|
| patient_id | patient_id |

### Relation Constraints

```yaml
required: [source]
```
````

### frontmatter

| 字段 | 说明 |
|------|------|
| `reverse_name` | 可选。从终点看向起点时的名称，如「检验对象」反向为「检验申请」 |
| `aliases` | 可选。别名列表，不得与 `name`、`reverse_name` 相同 |
| `importance` | 可选。`secondary`：辅助关系，主要关系答不了或问题明确涉及时才用；不写即 `primary`，`primary` 不要写出来 |
| `fallback_for` | 可选，只用于 `secondary`：本关系是所指主关系的替代路径，见下文 |
| `verification` | 可选。`confirmed`：按真实标识关联（外键或为关联而设的 ID）；`unconfirmed`：按规则推测（同号匹配、经中间对象推导），规则写在描述中，结果应标为待确认 |
| `lifecycle` | 可选，见「生命周期」 |

### Endpoint 与映射方式

`Source`、`Target` 是已定义的对象类 ID；`Type` 决定写哪些映射小节，只写与 `Type` 对应的小节：

| Type | 适用场景 | 映射小节 |
|------|----------|----------|
| `direct` | 一端的资源里有另一端的键（外键） | `### Mapping Rules`：`Source Property \| Target Property` |
| `indirect` | 关联记录在第三个资源（关联表）里；多对多，或关系本身带信息 | `### Backing Resource`：`Type \| ID`（`resource`）；`### Source Mapping`：`Source Property \| Resource Property`；`### Target Mapping`：`Resource Property \| Target Property` |
| `filtered_cross_join` | 没有键可对应，按条件圈定两端后全部相连 | `### Source Condition`、`### Target Condition`：条件 YAML（无 `object_type_id`） |

`Cardinality` 列可选：`one_to_one`、`one_to_many`、`many_to_one`、`many_to_many`，方向为 Source → Target；
统计的是不同的对端实例。`filtered_cross_join` 只能写 `many_to_many` 或不写。

### Relation Constraints（YAML）

| 键 | 说明 |
|----|------|
| `required` | `[source]`、`[target]` 或 `[source, target]`：该端每个实例至少关联一个对端 |
| `characteristics` | `symmetric`、`transitive` 的子集；只用于两端为同一对象类的关系 |

- `many_to_one` + `required: [source]` = 每个起点恰好一个终点。
- `symmetric` 关系：`Cardinality` 只能是 `one_to_one`、`many_to_many` 或不写；不写 `reverse_name`；`required` 只能不写或写 `[source, target]`。
- `transitive` 关系要起对名字：「隶属于」可以，「直接上级」不可以。数据只存直接的边，使用方按特性展开。

### 关系属性（只用于 indirect）

`indirect` 关系可以写 `### Data Properties`（列同对象类，`Mapped Field` 指向关联表的列，不得是连接列）
与 `### Property Constraints`（不支持 `unique`）。关系的有效期用 `valid_from` / `valid_to`：

```markdown
### Data Properties

| Name | Display Name | Type | Semantic | Description | Mapped Field |
|------|--------------|------|----------|-------------|--------------|
| title | 职务 | string | | 如主任、副主任 | title |
| start_date | 任职开始 | date | valid_from | | start_date |
| end_date | 任职结束 | date | valid_to | 在职时为空 | end_date |
```

### 替代路径 `fallback_for`

主关系有缺口（部分实例没有外键）时，用一条 `secondary` 关系补上：

```yaml
---
type: relation_type
id: order_for_patient_by_id_card
name: 检验对象（按身份证号）
importance: secondary
fallback_for: order_for_patient
verification: unconfirmed
---
```

- Source 实例沿主关系没有对端时，才用替代路径给出的对端；有主关系对端时替代路径的边不用。平台不自动执行，由使用方按 `search_schema` 给出的规则执行。
- 主关系必须是 `primary`、`active`，`Cardinality` 为 `many_to_one` 或 `one_to_one`，端点与方向和替代路径相同。
- 一个主关系至多一条替代路径；替代路径不能再被替代；两者都不能是 `filtered_cross_join` 或声明 `characteristics`。
- 端点与某条 `primary` 相同、回答同一问题的 `secondary` 关系，要么写 `fallback_for`，要么在数据层合并，否则使用方可能把结果相加。

## 行动类（action_types/*.bkn）

````markdown
---
type: action_type
id: revoke_lab_order
name: 撤销检验申请
aliases: [作废检验单, 退单]
action_intent: modify
---

## ActionType: 撤销检验申请

撤销尚未采样的检验申请。已采样或已出报告的申请不能撤销。

### Bound Object

| Bound Object |
|--------------|
| lab_order |

### Trigger Condition

```yaml
object_type_id: lab_order
field: status
operation: ==
value: N
```

### Action Source

| Type | BoxID | ToolID | McpID | ToolName |
|------|-------|--------|-------|----------|
| tool | box_lis | tool_revoke_order | | |

### Parameter Binding

| Name | Type | Source | Operation | ValueFrom | Value | Description |
|------|------|--------|-----------|-----------|-------|-------------|
| order_no | string | Body | | property | order_no | 申请单号 |
| reason | string | Body | | input | | 撤销原因 |

### Schedule

| Type | Expression |
|------|------------|
````

frontmatter：`action_intent`（`add` / `modify` / `delete`）、`aliases`（不得与网络内其他行动类的 `name` 相同）、`lifecycle`。不要写 `action_type`、`enabled`、`risk_level`、`requires_approval`。

| 小节 | 说明 |
|------|------|
| `Bound Object` | 一列 `Bound Object`：绑定的对象类 ID。可以不绑定，此时不能写触发条件，参数也不能取自属性 |
| `Affect Object` | 可选，列 `Affect Object \| Affect Description`：受影响的对象类与说明 |
| `Impact Contracts` | 可选，YAML：`impact_contracts:` 下的列表，每项 `object_type_id`、`expected_operation`（`add` / `modify` / `delete`）、`description`、`affected_fields` |
| `Trigger Condition` | 可选，条件 YAML，直接写条件（不要包在 `condition:` 下） |
| `Action Source` | 列 `Type \| BoxID \| ToolID \| McpID \| ToolName`；`tool` 填 `BoxID`、`ToolID`，`mcp` 填 `McpID`、`ToolName`，其余留空 |
| `Parameter Binding` | 列 `Name \| Type \| Source \| Operation \| ValueFrom \| Value \| Description` |
| `Schedule` | 列 `Type \| Expression`：`FIX_RATE`（间隔）或 `CRON`；可留空表 |

参数表：

- `ValueFrom` 必须是 `property`（对象属性）、`input`（运行时输入）或 `const`（常量）。
- `Value`：`property` 写属性名，`const` 写常量，`input` 留空。
- `Source` 是参数在工具请求中的位置：`Query`、`Body`、`Header`、`Path`。值的来源写在 `ValueFrom`，不是 `Source`。

工具必须在目标平台上存在：引用的工具箱工具或 MCP 工具找不到时 `push` 失败；
只想导入模型时用 `openbkn bkn push <dir> --binding-policy detach`，导入后在平台上重新绑定。

### 条件 YAML

```yaml
operation: and
sub_conds:
  - object_type_id: lab_order
    field: status
    operation: ==
    value: N
  - object_type_id: lab_order
    field: critical_level
    operation: not_in
    value: [危急]
```

| 类别 | 操作符 |
|------|--------|
| 逻辑 | `and`、`or`（`sub_conds` 最多 100 个） |
| 比较 | `==`、`!=`、`>`、`>=`、`<`、`<=` |
| 集合 | `in`、`not_in`、`contain`、`not_contain` |
| 区间 | `range`、`out_range`、`between`、`before`、`current` |
| 文本 | `like`、`not_like`、`prefix`、`not_prefix`、`regex` |
| 空值与存在 | `empty`、`not_empty`、`null`、`not_null`、`exist`、`not_exist` |
| 布尔 | `true`、`false` |

## 风险类（risk_types/*.bkn）

```markdown
---
type: risk_type
id: inventory_adjust_risk
name: 库存调整风险
---

## RiskType: 库存调整风险

库存调整需要双人复核。
```

只有通用字段与描述；管控函数与参数在平台上配置。

## 概念分组（concept_groups/*.bkn）

```markdown
---
type: concept_group
id: lab
name: 检验
---

## ConceptGroup: 检验

### Object Types

| ID | Name | Description |
|----|------|-------------|
| lab_order | 检验申请 | |
| patient | 患者 | |
```

只读取 `ID` 列，每个 ID 必须是已定义的对象类；`Name`、`Description` 由导出器填写。

## 别名

同一个概念的其他叫法，只供搜索召回与模型理解，不参与查询。

| 位置 | 写法 |
|------|------|
| 对象类、关系类、行动类 frontmatter | `aliases: [别名1, 别名2]`（必须是列表） |
| 属性（对象类与关系的 Data Properties） | `Aliases` 列，半角逗号分隔 |

- 每个别名非空，最长 40 字符，不含 `,` 与 `，`；每个定义或属性至多 10 个，组内不重复，不与自身名称相同。
- 对象类别名不得与其他对象类的 `name` 相同；行动类同理；属性别名不得与同一定义其他属性的 `Name`、`Display Name` 相同。

## 能力依赖（capabilities）

`network.bkn` frontmatter 中声明网络挂载的能力；ID 跨环境不保留，名称用于跨环境匹配，两者都写：

```yaml
capabilities:
  skills:
    - { id: skill_8f2c, name: 交期评估 }
  functions:
    - { box_id: box_supply, tool_id: tool_bom_expand, box_name: 供应链计算, tool_name: BOM 多层展开 }
  mcp_tools:
    - { mcp_id: mcp_erp, mcp_name: ERP 查询, tool_name: query_po }
  knowledge_bases:
    - { id: "7", name: 合同库 }
```

- 只能有这四个类别与上面的字段。条目缺少匹配所需的字段时拒绝：`skills` 的 `id`、`name` 都没写；`functions` 的 `box_id` + `tool_id` 与 `box_name` + `tool_name` 两组都不齐全；`mcp_tools` 没写 `tool_name`，或 `mcp_id`、`mcp_name` 都没写。
- 目标环境匹配不到的条目不会让导入失败，列为跳过项。
- 行动类与逻辑属性引用的工具不必写进 `capabilities`。

## 业务规则放在哪里

| 范围 | 位置 |
|------|------|
| 网络 | `network.bkn` 的 `#` 标题之后的描述 |
| 定义 | `##` 标题之后、第一个 `###` 之前的描述；不放 frontmatter |
| 属性 | Data Properties 的 `Description` 列；能结构化的（语义、必填、单位、枚举、格式、范围）写成声明 |

不要添加规范外的 frontmatter 字段或 `###` 小节：3.0 下会被拒绝导入。

## 2.x 规范写法

不写 `bkn_spec` 的包按 2.x 读取，所有平台读法相同（0.2.0 平台只认 2.x）。2.x 读到 3.0 的内容不会报错，但会被丢掉或并进描述：
`### Property Constraints`、`### Relation Constraints`、关系的 `### Data Properties` 变成描述文字，`value_types/` 与新字段、新列被忽略，
替代路径与弃用的关系变成普通关系。所以写 2.x 包时，按本文写，再去掉下面这些：

| 去掉 | 要表达的内容改写到 |
|------|--------------------|
| `network.bkn` 的 `bkn_spec` | — |
| `value_types/` 整个目录与属性的 `value_type` | 属性 `Description`：编码与含义，如「N 已开单、C 已撤销；X 是旧撤销编码，筛已撤销时写 IN (C, X)」；格式、范围 |
| Data Properties 的 `Semantic`、`Required`、`Aliases` 列 | 属性 `Description`；时间范围按哪个属性判断写进定义描述 |
| `### Property Constraints` | 属性 `Description`：单位、时区、坐标系、格式、唯一 |
| frontmatter 的 `aliases` | 定义描述：「也称 ……」 |
| 关系的 `reverse_name`、`verification`、`Cardinality` 列、`### Relation Constraints` | 关系描述：如「每张申请对应一个患者」「可逐级向上追溯」 |
| `indirect` 关系的 `### Data Properties` | 关系描述：关联表一行代表什么、有哪些列 |
| `importance: secondary` + `fallback_for` 的替代路径关系 | 不建这条关系；在主关系描述里写明替代匹配规则与「结果待确认」 |
| `lifecycle` 为 `deprecated` 的定义 | 不导入；已在平台上的用平台删除 |
| 行动类的 `aliases` | 行动描述 |

其余写法与 3.0 相同，2.x 都能读：`### Action Source` 与列 `BoxID`、`ToolID`、`McpID`、`ToolName`，
参数表 `Name | Type | Source | Operation | ValueFrom | Value | Description`，直接写的条件 YAML，`action_intent`。
不要退回 2.x 的旧写法（`### Tool Configuration`、`Parameter | Source | Binding`、`condition:` 包装、
`enabled` / `risk_level` 等字段、`Pre-conditions` 等小节）：2.x 对它们要么丢参数，要么静默忽略。

完整示例见 `references/examples/clinic-lab-2.x/`（与 `clinic-lab` 是同一个网络）。

## 更新与删除

- 导入按 `(网络, 类型, id)` 新增或覆盖；修改即编辑文件后重新 `push`。
- BKN 文件不能表达删除；删除用 CLI / API 的 delete。不要生成 `type: delete` 或 `type: patch` 文件。

## 输出规则（必须遵守）

1. 只输出 BKN 文件内容（frontmatter + 正文），不要用 ```` ```markdown ```` 包裹整个文件。
2. 写 3.0 时 `network.bkn` 写 `bkn_spec: "3.0"`；写 2.x 时不写，并按「2.x 规范写法」去掉 3.0 内容。
3. 引用的 ID（端点、映射属性、`value_type`、`fallback_for`、`replaced_by`、绑定对象、概念分组成员）必须在包内已定义。
4. 表格列名、小节标题严格按本文；不要写 HTML 注释、引用块或其他说明文字到小节里。
5. ID 用小写字母、数字、下划线；显示名和描述用中文（除非另有要求）。
6. 必需内容：所有定义 `type`、`id`、`name`；对象类 `Data Properties`、`Keys`；关系类 `Endpoint` 与对应映射小节；值类型 `Definition`；概念分组 `Object Types`。
7. 写默认值等于不写，但不要写出来：`importance: primary`、`lifecycle.status: active`、`Required: false`、主键的 `Required: true`。
