#!/usr/bin/env node

import { createClient } from "../../dist/index.js";

const baseUrl = process.env.BKN_BASE_URL ?? "http://localhost";
const knId = process.env.BKN_KN_ID ?? "supplychain_hd0202";
const agentName = process.env.BKN_AGENT_NAME ?? "供应链分析助手";
const client = createClient({ baseUrl });
const hostConversationKey = `sdk-e2e:${Date.now()}`;

let conversationId;

const juneQuestion = "6月份有哪些需求预测单，列出来，需求总量是多少？";
const june = await runInteraction({
  key: "june",
  question: juneQuestion,
  start: "2026-06-01",
  end: "2026-07-01",
  answerFor: (rows) => {
    const forecastCount = Number(rows[0]?.forecast_count);
    const totalDemand = Number(rows[0]?.total_demand);
    if (forecastCount !== 63 || totalDemand !== 11_594) {
      throw new Error(
        `unexpected June forecast result: count=${forecastCount}, total=${totalDemand}`,
      );
    }
    return `6月份共有 ${forecastCount} 条需求预测，需求总量为 ${totalDemand}。`;
  },
});

const comparisonQuestion = "7月份有哪些需求预测单，各个产品的预测需求量是多少？相比6月有什么变化？";
const comparison = await runInteraction({
  key: "july-comparison",
  question: comparisonQuestion,
  start: "2026-06-01",
  end: "2026-08-01",
  answerFor: (rows, binding) => {
    const monthly = aggregateByMonth(rows, binding);
    if (monthly["2026-06"]?.count !== 63 || monthly["2026-06"]?.total !== 11_594) {
      throw new Error(`unexpected June comparison baseline: ${JSON.stringify(monthly["2026-06"])}`);
    }
    if (monthly["2026-07"]?.count !== 40 || monthly["2026-07"]?.total !== 4_586) {
      throw new Error(`unexpected July forecast result: ${JSON.stringify(monthly["2026-07"])}`);
    }
    const decrease = monthly["2026-06"].total - monthly["2026-07"].total;
    return `7月份共有 40 条需求预测，需求总量为 4586；相比6月减少 ${decrease}，约下降60%。`;
  },
});

const salesOrders = await runSalesOrderInteraction();

const interactions = [june, comparison, salesOrders];
const operations = interactions.flatMap((item) => item.operations);
if (interactions.length !== 3 || operations.length < 7) {
  throw new Error(
    `invalid provenance hierarchy: interactions=${interactions.length}, operations=${operations.length}`,
  );
}

async function runSalesOrderInteraction() {
  const question = "迄今为止有多少销售订单，分别属于哪些产品？";
  const interaction = await startInteraction("sales-orders", question);
  assertString(interaction?.interaction_id, "interaction_id");
  rememberConversation(interaction);

  const schemaCall = await managedOperation(
    interaction.interaction_id,
    "sales-orders:schema",
    "search_schema",
    {
      query: "销售订单 产品 签约数量",
      response_format: "json",
      include_columns: true,
      max_concepts: 20,
      bkn_context: businessContext(interaction.interaction_id),
    },
  );
  const binding = extractSalesOrderBinding(schemaCall.value);
  const rejectedCall = await managedRejectedOperation(
    interaction.interaction_id,
    "sales-orders:read-only-rejection",
    "run_sql",
    {
      sql: "DELETE FROM forbidden",
      response_format: "json",
      bkn_context: businessContext(interaction.interaction_id),
    },
  );
  const dataCall = await managedOperation(
    interaction.interaction_id,
    "sales-orders:data",
    "run_sql",
    {
      sql: buildSalesOrderSql(binding),
      response_format: "json",
      bkn_context: businessContext(interaction.interaction_id),
    },
  );
  const rows = extractRows(dataCall.value);
  const orderCount = rows.reduce((sum, row) => sum + Number(row.order_count ?? 0), 0);
  const signingQuantity = rows.reduce((sum, row) => sum + Number(row.signing_quantity ?? 0), 0);
  if (rows.length !== 10 || orderCount !== 1_441 || signingQuantity !== 15_991) {
    throw new Error(
      `unexpected sales order result: products=${rows.length}, orders=${orderCount}, quantity=${signingQuantity}`,
    );
  }
  const answer = `共有 ${orderCount} 张销售订单，涉及 ${rows.length} 个产品，签约数量合计 ${signingQuantity}。`;
  const receipts = [schemaCall.receipt, rejectedCall.receipt, dataCall.receipt];
  const completed = await client.context.toolCall(knId, "bkn_finish_interaction", {
    interaction_id: interaction.interaction_id,
    outcome: "completed",
    answer,
  });
  return {
    interaction_id: interaction.interaction_id,
    question,
    answer,
    execution_status: completed.execution_status,
    evidence_status: completed.evidence_status,
    operations: summarizeReceipts(receipts),
  };
}

console.log(
  JSON.stringify(
    {
      passed: true,
      conversation_id: conversationId,
      expected_view_counts: { conversations: 1, interactions: 3, openbkn_calls: operations.length },
      interactions,
    },
    null,
    2,
  ),
);

async function runInteraction({ key, question, start, end, answerFor }) {
  const interaction = await startInteraction(key, question);
  assertString(interaction?.interaction_id, "interaction_id");
  rememberConversation(interaction);

  const schemaCall = await managedOperation(
    interaction.interaction_id,
    `${key}:schema`,
    "search_schema",
    {
      query: question,
      response_format: "json",
      include_columns: true,
      max_concepts: 20,
      bkn_context: businessContext(interaction.interaction_id),
    },
  );
  const binding = extractForecastBinding(schemaCall.value);
  const dataCall = await managedOperation(interaction.interaction_id, `${key}:data`, "run_sql", {
    sql: buildForecastSql(binding, start, end),
    response_format: "json",
    bkn_context: businessContext(interaction.interaction_id),
  });
  const rows = extractRows(dataCall.value);
  if (rows.length === 0) throw new Error(`run_sql returned no rows for ${key}`);

  const answer = answerFor(rows, binding);
  const receipts = [schemaCall.receipt, dataCall.receipt];
  const completed = await client.context.toolCall(knId, "bkn_finish_interaction", {
    interaction_id: interaction.interaction_id,
    outcome: "completed",
    answer,
  });
  return {
    interaction_id: interaction.interaction_id,
    question,
    answer,
    execution_status: completed.execution_status,
    evidence_status: completed.evidence_status,
    operations: summarizeReceipts(receipts),
  };
}

function summarizeReceipts(receipts) {
  return receipts.map((receipt) => ({
    operation_id: receipt.operation_id,
    operation_key: receipt.operation_key,
    tool_name: receipt.tool_name,
    receipt_id: receipt.receipt_id,
    trace_id: receipt.trace_id,
    request_id: receipt.request_id,
    evidence_durability: receipt.evidence_durability,
    business_refs: receipt.business_refs,
  }));
}

function operationClient() {
  return createClient({ baseUrl });
}

function managedOperation(interactionId, invocationSuffix, toolName, args) {
  return operationClient().context.managedToolCall(knId, toolName, args, {
    clientInvocationId: `operation:${interactionId}:${invocationSuffix}`,
  });
}

async function managedRejectedOperation(interactionId, invocationSuffix, toolName, args) {
  const result = await operationClient().context.callMethod(knId, "tools/call", {
    name: toolName,
    arguments: args,
    _meta: {
      "openbkn.ai/client-invocation-id": `operation:${interactionId}:${invocationSuffix}`,
    },
  });
  if (result?.isError !== true) {
    throw new Error(`${toolName} rejection scenario unexpectedly succeeded`);
  }
  const receipt = result?.structuredContent?.bkn_receipt;
  if (receipt?.receipt_status !== "failed") {
    throw new Error(`${toolName} rejection scenario did not return a failed durable receipt`);
  }
  return { value: result, receipt };
}

function businessContext(interactionId) {
  return {
    conversation_id: conversationId,
    interaction_id: interactionId,
  };
}

function rememberConversation(interaction) {
  assertString(interaction?.conversation_id, "conversation_id");
  if (conversationId && conversationId !== interaction.conversation_id) {
    throw new Error(
      `conversation changed across turns: ${conversationId} != ${interaction.conversation_id}`,
    );
  }
  conversationId = interaction.conversation_id;
}

function startInteraction(key, question) {
  return client.context.toolCall(
    knId,
    "bkn_start_interaction",
    {
      ...(conversationId ? { conversation_id: conversationId } : {}),
      ...(!conversationId ? { agent_name: agentName } : {}),
      question,
    },
    {
      hostConversationKey,
      clientInvocationId: `interaction:${key}`,
    },
  );
}

function extractForecastBinding(value) {
  const candidates = [];
  walk(value, (item) => {
    const properties = item.data_properties ?? item.properties;
    const source = item.data_source ?? item.data_sources;
    if (Array.isArray(properties) && source) candidates.push({ item, properties, source });
  });
  const selected =
    candidates.find(
      ({ item, properties }) =>
        `${item.id ?? ""} ${item.name ?? ""} ${item.display_name ?? ""} ${item.concept_id ?? ""} ${item.concept_name ?? ""}`.match(
          /forecast|需求预测/i,
        ) && hasProperty(properties, ["consensus_demand", "qty", "demand_quantity"]),
    ) ??
    candidates.find(
      ({ properties }) =>
        hasProperty(properties, ["consensus_demand", "qty", "demand_quantity"]) &&
        hasProperty(properties, ["month", "startdate", "forecast_month", "bizdate"]),
    );
  if (!selected) throw new Error("search_schema did not return the forecast object binding");

  const sources = Array.isArray(selected.source) ? selected.source : [selected.source];
  const resourceId = sources
    .map((source) => source?.id ?? source?.resource_id)
    .find((id) => typeof id === "string" && id);
  const month = propertyBinding(selected.properties, [
    "month",
    "startdate",
    "forecast_month",
    "bizdate",
  ]);
  const demand = propertyBinding(selected.properties, [
    "consensus_demand",
    "qty",
    "demand_quantity",
  ]);
  const product = propertyBinding(selected.properties, ["product_code", "material_number"]);
  const order = propertyBinding(selected.properties, ["confirmed_order", "billno", "id"]);
  if (!resourceId) throw new Error("forecast schema binding is missing its data resource");
  return {
    resourceId,
    month,
    demand,
    product,
    order,
  };
}

function extractSalesOrderBinding(value) {
  let selected;
  walk(value, (item) => {
    if (
      !selected &&
      `${item.concept_id ?? ""} ${item.concept_name ?? ""}`.match(/salesorder|销售订单/i) &&
      Array.isArray(item.data_properties) &&
      item.data_source
    ) {
      selected = item;
    }
  });
  if (!selected) throw new Error("search_schema did not return the sales order binding");
  const resourceId = selected.data_source.id ?? selected.data_source.resource_id;
  if (!resourceId) throw new Error("sales order schema binding is missing its data resource");
  return {
    resourceId,
    productCode: propertyBinding(selected.data_properties, ["product_code"]),
    productName: propertyBinding(selected.data_properties, ["product_name"]),
    signingQuantity: propertyBinding(selected.data_properties, ["signing_quantity"]),
  };
}

function buildSalesOrderSql(binding) {
  const productCode = quoteIdentifier(binding.productCode.column);
  const productName = quoteIdentifier(binding.productName.column);
  const signingQuantity = quoteIdentifier(binding.signingQuantity.column);
  return [
    `SELECT ${productCode}, MAX(${productName}) AS product_name,`,
    "COUNT(*) AS order_count,",
    `SUM(CAST(${signingQuantity} AS DOUBLE)) AS signing_quantity`,
    `FROM {{.${binding.resourceId}}}`,
    `GROUP BY ${productCode}`,
    "ORDER BY signing_quantity DESC",
  ].join(" ");
}

function hasProperty(properties, logicalNames) {
  return properties.some((property) => logicalNames.includes(property.name));
}

function propertyBinding(properties, logicalNames) {
  const property = logicalNames
    .map((logicalName) => properties.find((item) => item.name === logicalName))
    .find(Boolean);
  if (!property) throw new Error(`forecast schema is missing one of: ${logicalNames.join(", ")}`);
  return {
    logicalName: property.name,
    column: property.column ?? property.mapped_field ?? property.name,
  };
}

function buildForecastSql(binding, start, end) {
  const columns = [binding.product, binding.order, binding.demand, binding.month].map(
    ({ column }) => quoteIdentifier(column),
  );
  const month = quoteIdentifier(binding.month.column);
  const demand = quoteIdentifier(binding.demand.column);
  return [
    `SELECT ${columns.join(", ")},`,
    "COUNT(*) OVER () AS forecast_count,",
    `SUM(CAST(${demand} AS DOUBLE)) OVER () AS total_demand`,
    `FROM {{.${binding.resourceId}}}`,
    `WHERE ${month} >= '${start}' AND ${month} < '${end}'`,
    `ORDER BY ${month}, ${quoteIdentifier(binding.product.column)}`,
  ].join(" ");
}

function aggregateByMonth(rows, binding) {
  const result = {};
  for (const row of rows) {
    const month = String(row[binding.month.column] ?? "").slice(0, 7);
    if (!month) continue;
    result[month] ??= { count: 0, total: 0 };
    result[month].count += 1;
    result[month].total += Number(row[binding.demand.column] ?? 0);
  }
  return result;
}

function extractRows(value) {
  if (Array.isArray(value?.entries)) return value.entries;
  if (Array.isArray(value?.data?.entries)) return value.data.entries;
  throw new Error("run_sql response does not contain entries");
}

function walk(value, visitor) {
  if (!value || typeof value !== "object") return;
  if (!Array.isArray(value)) visitor(value);
  for (const child of Array.isArray(value) ? value : Object.values(value)) walk(child, visitor);
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function assertString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`managed lifecycle response is missing ${name}`);
  }
}
