# 门诊检验网络（BKN 2.x）- Agent 使用指南

> **网络ID**: clinic_lab
> **规范**: BKN 2.x（不写 `bkn_spec`）
> **标签**: 医疗

## 网络概览

门诊检验申请，以及相关的患者、医生与科室。这是 `clinic-lab` 的 2.x 版：2.x 没有 3.0 的声明，
编码含义、单位、时区、坐标系、匹配规则都写在描述里。

### 对象

| 对象 | 文件路径 | 说明 |
|------|----------|------|
| 检验申请 | `object_types/lab_order.bkn` | 按 `ordered_at` 判断时间范围；`status` 编码见属性说明 |
| 患者 | `object_types/patient.bkn` | 身份证号脱敏 |
| 医生 | `object_types/doctor.bkn` | |
| 科室 | `object_types/department.bkn` | 位置为高德坐标系 |

### 关系

| 关系 | 文件路径 | 源 → 目标 | 说明 |
|------|----------|-----------|------|
| order_for_patient | `relation_types/order_for_patient.bkn` | 检验申请 → 患者 | 按患者编号；未建档时按身份证号匹配，结果待确认 |
| order_by_doctor | `relation_types/order_by_doctor.bkn` | 检验申请 → 医生 | 每张申请都有开单医生 |
| doctor_in_department | `relation_types/doctor_in_department.bkn` | 医生 → 科室 | 经任职表，多对多 |
| department_under | `relation_types/department_under.bkn` | 科室 → 科室 | 可逐级向上追溯 |

### 行动

| 行动 | 文件路径 | 绑定对象 | 说明 |
|------|----------|----------|------|
| revoke_lab_order | `action_types/revoke_lab_order.bkn` | 检验申请 | 撤销未采样的申请 |

### 概念分组

| 分组 | 文件路径 | 包含对象 |
|------|----------|----------|
| lab | `concept_groups/lab.bkn` | 检验申请、患者 |

## 使用建议

1. **按状态筛选**：「已撤销」写 `status IN ('C', 'X')`，X 是旧编码。
2. **时间范围**：按 `ordered_at` 过滤；出报告时长用 `reported_at - ordered_at`。
