# CRM 客户关系与销售管理 - Agent 使用指南

> **网络ID**: crm-management  
> **版本**:   
> **标签**: CRM, 履约, 采购, 销售  

## 网络概览

覆盖 CRM 客户关系与销售履约全链路：线索、商机、报价、合同、销售订单、发货、开票、回款，以及产品、采购、库存与供应商。业务规则：报价审批通过后方可转合同（RE-006）。

### 核心对象

| 对象 | 文件路径 | 说明 |
|------|----------|------|
| 跟进活动 | `object_types/activity.bkn` | 拜访、电话、邮件等客户跟进记录。 |
| 联系人 | `object_types/contact.bkn` | 客户方联系人，含职位、决策角色与联系方式。 |
| 合同 | `object_types/contract.bkn` | 销售合同，含履约、发票、收款与交付状态。 |
| 合同明细 | `object_types/contract_item.bkn` | 合同行：产品、数量、单价与金额。 |
| crm-management-rules | `object_types/crm-management-rules.bkn` | CRM 客户关系与销售管理业务规则 Skill 的锚定对象，承载规则文件路径、类型、条数、来源与关联业务对象等元信息。 |
| 系统用户 | `object_types/crm_user.bkn` | 员工/销售/系统账号。 |
| 客户 | `object_types/customer.bkn` | 企业或组织客户主数据，含行业归属、客户等级、状态及归属销售。 |
| 发货单 | `object_types/delivery_order.bkn` | 出库发货记录，含物流、签收与异常标记。 |
| 行业 | `object_types/industry.bkn` | 行业分类维度。 |
| 库存 | `object_types/inventory_stock.bkn` | 库存量：可用/锁定/在途/破损与安全库存。 |
| 发票 | `object_types/invoice.bkn` | 销售发票，含红冲、税额，关联订单与合同。 |
| 线索 | `object_types/lead.bkn` | 潜在客户线索，可转化为商机或客户。 |
| 商机 | `object_types/opportunity.bkn` | 销售机会，含阶段、预计金额、赢率与预计签单日。 |
| 收款单 | `object_types/payment_receipt.bkn` | 回款记录，含核销状态，关联发票/订单/合同。 |
| 产品 | `object_types/product.bkn` | 商品主数据，含 SKU、分类、品牌与标准价格。 |
| 产品成本记录 | `object_types/product_cost.bkn` | 产品成本历史/版本记录。 |
| 产品价格记录 | `object_types/product_price.bkn` | 产品价格历史/版本记录。 |
| 采购订单 | `object_types/purchase_order.bkn` | 向供应商采购的单据，含收付款与到货状态。 |
| 采购订单明细 | `object_types/purchase_order_item.bkn` | 采购行：产品、数量、单价与金额。 |
| 报价单 | `object_types/quotation.bkn` | 报价单头，含版本、审批状态与金额。 |
| 报价明细 | `object_types/quotation_item.bkn` | 报价行：产品、数量、单价、折扣与毛利。 |
| 销售订单 | `object_types/sales_order.bkn` | 销售订单头，关联合同/报价，含收付款与交付状态。 |
| 销售订单明细 | `object_types/sales_order_item.bkn` | 订单行：产品、数量、单价与金额。 |
| 供应商 | `object_types/supplier.bkn` | 供应商主数据，含资质、信用与风险等级。 |

### 核心关系

| 关系 | 文件路径 | 说明 |
|------|----------|------|
| 关联联系人 | `relation_types/activity_refs_contact.bkn` | 跟进活动关联联系人 |
| 关联客户 | `relation_types/activity_refs_customer.bkn` | 跟进活动关联客户 |
| 关联商机 | `relation_types/activity_refs_opportunity.bkn` | 跟进活动关联商机 |
| 生成销售订单 | `relation_types/contract_generates_order.bkn` | 合同生成销售订单 |
| 包含合同明细 | `relation_types/contract_has_item.bkn` | 合同包含多行明细 |
| 关联收款 | `relation_types/contract_has_receipt.bkn` | 合同关联收款单 |
| 引用产品 | `relation_types/contract_item_refs_product.bkn` | 合同明细引用产品 |
| 属于 | `relation_types/customer_belongs_industry.bkn` | 客户归属于某个行业 |
| 拥有联系人 | `relation_types/customer_has_contact.bkn` | 客户拥有多个联系人 |
| 拥有商机 | `relation_types/customer_has_opportunity.bkn` | 客户拥有多个商机 |
| 拥有报价单 | `relation_types/customer_has_quotation.bkn` | 客户拥有多个报价单 |
| 核销发票 | `relation_types/invoice_has_receipt.bkn` | 发票被收款单核销 |
| 转化为客户 | `relation_types/lead_converts_to_customer.bkn` | 线索转化为客户 |
| 转化为商机 | `relation_types/lead_converts_to_opportunity.bkn` | 线索转化为商机 |
| 关联联系人 | `relation_types/opportunity_refs_contact.bkn` | 商机关联客户联系人 |
| 生成发货单 | `relation_types/order_generates_delivery.bkn` | 销售订单生成发货单 |
| 生成发票 | `relation_types/order_generates_invoice.bkn` | 销售订单生成发票 |
| 包含订单明细 | `relation_types/order_has_item.bkn` | 销售订单包含多行明细 |
| 关联收款 | `relation_types/order_has_receipt.bkn` | 销售订单关联收款单 |
| 引用产品 | `relation_types/order_item_refs_product.bkn` | 订单明细引用产品 |
| 有成本记录 | `relation_types/product_has_cost.bkn` | 产品有成本记录 |
| 有价格记录 | `relation_types/product_has_price.bkn` | 产品有价格记录 |
| 有库存 | `relation_types/product_has_stock.bkn` | 产品有库存记录 |
| 引用产品 | `relation_types/purchase_item_refs_product.bkn` | 采购明细引用产品 |
| 属于供应商 | `relation_types/purchase_order_belongs_supplier.bkn` | 采购订单属于某供应商 |
| 包含采购明细 | `relation_types/purchase_order_has_item.bkn` | 采购订单包含多行明细 |
| 生成销售订单 | `relation_types/quotation_generates_order.bkn` | 报价单生成销售订单 |
| 包含报价明细 | `relation_types/quotation_has_item.bkn` | 报价单包含多行明细 |
| 引用产品 | `relation_types/quotation_item_refs_product.bkn` | 报价明细引用产品 |
| 签订为合同 | `relation_types/quotation_signs_to_contract.bkn` | 报价单签订为合同 |
| 跟进活动 | `relation_types/user_creates_activity.bkn` | 销售员工创建跟进活动 |
| 负责合同 | `relation_types/user_owns_contract.bkn` | 销售员工负责合同 |
| 负责客户 | `relation_types/user_owns_customer.bkn` | 销售员工负责客户 |
| 负责线索 | `relation_types/user_owns_lead.bkn` | 销售员工负责线索 |
| 负责商机 | `relation_types/user_owns_opportunity.bkn` | 销售员工负责商机 |

### 可用行动

| 行动 | 文件路径 | 说明 |
|------|----------|------|
| 合同生成订单 | `action_types/contract_to_order.bkn` | 合同签订生效后生成销售订单

### Scope of Impact

| Object | Impact Description |
|--------|---------------------|
| sales_order | 合同生成订单 执行影响的对象 |

### Execution Description

1. 校验 contract 对象状态
2. 执行 合同生成订单
3. 回写状态并记录审计 |
| 线索转化 | `action_types/convert_lead.bkn` | 将已转化的线索同步为商机和客户记录

### Scope of Impact

| Object | Impact Description |
|--------|---------------------|
| opportunity | 线索转化 执行影响的对象 |
| customer | 线索转化 执行影响的对象 |

### Execution Description

1. 校验 lead 对象状态
2. 执行 线索转化
3. 回写状态并记录审计 |
| 订单开票 | `action_types/order_to_invoice.bkn` | 销售订单发货完成后开具发票

### Scope of Impact

| Object | Impact Description |
|--------|---------------------|
| invoice | 订单开票 执行影响的对象 |

### Execution Description

1. 校验 sales_order 对象状态
2. 执行 订单开票
3. 回写状态并记录审计 |
| 查询库存 | `action_types/query_inventory.bkn` | 查询产品库存可用量（只读，平台暂不支持 query，用 modify 语义标注）

### Scope of Impact

| Object | Impact Description |
|--------|---------------------|
| inventory_stock | 查询库存 执行影响的对象 |

### Execution Description

1. 校验 inventory_stock 对象状态
2. 执行 查询库存
3. 回写状态并记录审计 |
| 报价转合同 | `action_types/quotation_to_contract.bkn` | 报价单审批通过后生成合同

### Scope of Impact

| Object | Impact Description |
|--------|---------------------|
| contract | 报价转合同 执行影响的对象 |

### Execution Description

1. 校验 quotation 对象状态
2. 执行 报价转合同
3. 回写状态并记录审计 |
| 收款核销 | `action_types/receipt_verify.bkn` | 登记收款并核销对应发票

### Scope of Impact

| Object | Impact Description |
|--------|---------------------|
| invoice | 收款核销 执行影响的对象 |

### Execution Description

1. 校验 payment_receipt 对象状态
2. 执行 收款核销
3. 回写状态并记录审计 |
| 登记跟进 | `action_types/register_activity.bkn` | 登记客户跟进活动记录

### Scope of Impact

| Object | Impact Description |
|--------|---------------------|
| activity | 登记跟进 执行影响的对象 |

### Execution Description

1. 校验 activity 对象状态
2. 执行 登记跟进
3. 回写状态并记录审计 |
| 登记发货 | `action_types/register_delivery.bkn` | 登记出库发货单

### Scope of Impact

| Object | Impact Description |
|--------|---------------------|
| delivery_order | 登记发货 执行影响的对象 |

### Execution Description

1. 校验 delivery_order 对象状态
2. 执行 登记发货
3. 回写状态并记录审计 |

## 目录结构

```
.
├── network.bkn
├── SKILL.md
├── CHECKSUM
├── object_types/
├── relation_types/
└── action_types/
├── concept_groups/
```

## 使用建议

### 查询场景

1. **获取所有对象定义**
   - 查看 `object_types/` 目录下的文件

2. **查找关系定义**
   - 查看 `relation_types/` 目录下的文件

### 运维场景

1. **执行运维操作**
   - 查看 `action_types/` 目录下的行动定义
   - 了解触发条件和参数绑定

## 索引表

### 按类型索引

- **对象定义**: `object_types/`
- **关系定义**: `relation_types/`
- **行动定义**: `action_types/`
- **概念分组**: `concept_groups/`

1. 本网络由 BKN SDK 自动生成 SKILL.md
2. 所有定义遵循 BKN 规范
3. 使用 CHECKSUM 文件验证网络完整性
