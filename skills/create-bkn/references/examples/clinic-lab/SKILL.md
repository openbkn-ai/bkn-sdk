# 门诊检验网络 - Agent 使用指南

> **网络ID**: clinic_lab
> **规范**: BKN 3.0（`bkn_spec: "3.0"`）
> **标签**: 医疗

## 网络概览

门诊检验申请，以及相关的患者、医生与科室。本例用到 BKN 3.0 的全部声明：属性语义与必填、属性约束、值类型、别名、关系的反向名称、基数、关系约束、关系属性、生命周期、主次关系与替代路径、可信度。

### 值类型

| 值类型 | 文件路径 | 种类 | 说明 |
|--------|----------|------|------|
| lis_apply_status | `value_types/lis_apply_status.bkn` | 枚举 | 检验申请状态码；X 是停用的旧撤销编码 |
| cn_id_card | `value_types/cn_id_card.bkn` | 格式 | 18 位居民身份证号 |
| amount_cny | `value_types/amount_cny.bkn` | 区间 | 人民币金额，单位元 |

### 对象

| 对象 | 文件路径 | 说明 |
|------|----------|------|
| 检验申请 | `object_types/lab_order.bkn` | 事件类（有 `event_time`）；状态引用枚举值类型 |
| 患者 | `object_types/patient.bkn` | 身份证号引用格式值类型并脱敏 |
| 医生 | `object_types/doctor.bkn` | 执业证有效期 `valid_to` |
| 科室 | `object_types/department.bkn` | 位置 `location`，坐标系 gcj02 |

### 关系

| 关系 | 文件路径 | 源 → 目标 | 说明 |
|------|----------|-----------|------|
| order_for_patient | `relation_types/order_for_patient.bkn` | 检验申请 → 患者 | 主关系，多对一，按患者编号，已确认 |
| order_for_patient_by_id_card | `relation_types/order_for_patient_by_id_card.bkn` | 检验申请 → 患者 | 替代路径（`fallback_for`），按身份证号，待确认 |
| order_by_doctor | `relation_types/order_by_doctor.bkn` | 检验申请 → 医生 | 多对一，每张申请都有开单医生 |
| order_by_legacy_doctor | `relation_types/order_by_legacy_doctor.bkn` | 检验申请 → 医生 | 已弃用，改用 order_by_doctor |
| doctor_in_department | `relation_types/doctor_in_department.bkn` | 医生 → 科室 | indirect，多对多，带职务与任职起止 |
| department_under | `relation_types/department_under.bkn` | 科室 → 科室 | 自引用，可传递 |

### 行动

| 行动 | 文件路径 | 绑定对象 | 说明 |
|------|----------|----------|------|
| revoke_lab_order | `action_types/revoke_lab_order.bkn` | 检验申请 | 撤销未采样的申请 |

### 概念分组

| 分组 | 文件路径 | 包含对象 |
|------|----------|----------|
| lab | `concept_groups/lab.bkn` | 检验申请、患者 |

## 使用建议

1. **按状态筛选**：`status` 存编码，按含义筛选时带上停用编码，如「已撤销」写 `status IN ('C', 'X')`。
2. **找申请对应的患者**：先走 `order_for_patient`；申请单沿它找不到患者时，才用 `order_for_patient_by_id_card`，结果标为待确认。
3. **时间范围**：「最近一周的检验申请」按 `ordered_at` 过滤；出报告时长用 `reported_at - ordered_at`。
4. **科室层级**：`department_under` 可传递，「内科下辖的所有科室」要逐级展开。
5. **不要用** `order_by_legacy_doctor`，它已弃用。
