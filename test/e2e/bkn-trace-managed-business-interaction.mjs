#!/usr/bin/env node

import { createClient } from "../../dist/index.js";

const baseUrl = process.env.BKN_BASE_URL ?? "http://localhost";
const knId = process.env.BKN_KN_ID ?? "supplychain_hd0202";
const agentName = process.env.BKN_AGENT_NAME ?? "供应链分析助手";
const client = createClient({ baseUrl });
const hostConversationKey = `sdk-e2e:${Date.now()}`;
// Defaults are the figures of supplychain_hd0202; override them to run against another copy.
const expected = {
  june: {
    count: numeric(process.env.BKN_EXPECTED_JUNE_FORECAST_COUNT, 63),
    total: numeric(process.env.BKN_EXPECTED_JUNE_TOTAL_DEMAND, 11_594),
  },
  july: {
    count: numeric(process.env.BKN_EXPECTED_JULY_FORECAST_COUNT, 40),
    total: numeric(process.env.BKN_EXPECTED_JULY_TOTAL_DEMAND, 4_586),
  },
  salesOrders: {
    products: numeric(process.env.BKN_EXPECTED_SALES_PRODUCT_COUNT, 10),
    orders: numeric(process.env.BKN_EXPECTED_SALES_ORDER_COUNT, 1_441),
    quantity: numeric(process.env.BKN_EXPECTED_SALES_SIGNING_QUANTITY, 15_991),
  },
};

let conversationId;

const juneQuestion = "6月份有哪些需求预测单，列出来，需求总量是多少？";
const june = await runInteraction({
  key: "june",
  question: juneQuestion,
  start: "2026-06-01",
  until: "2026-07-01",
  answerFor: (rows, binding) => {
    const { count, total } = aggregateByMonth(rows, binding)["2026-06"] ?? {};
    if (count !== expected.june.count || total !== expected.june.total) {
      throw new Error(`unexpected June forecast result: count=${count}, total=${total}`);
    }
    return `6月份共有 ${count} 条需求预测，需求总量为 ${total}。`;
  },
});

const comparisonQuestion = "7月份有哪些需求预测单，各个产品的预测需求量是多少？相比6月有什么变化？";
const comparison = await runInteraction({
  key: "july-comparison",
  question: comparisonQuestion,
  start: "2026-06-01",
  until: "2026-08-01",
  answerFor: (rows, binding) => {
    const monthly = aggregateByMonth(rows, binding);
    const juneTotals = monthly["2026-06"];
    const julyTotals = monthly["2026-07"];
    if (juneTotals?.count !== expected.june.count || juneTotals?.total !== expected.june.total) {
      throw new Error(`unexpected June comparison baseline: ${JSON.stringify(juneTotals)}`);
    }
    if (julyTotals?.count !== expected.july.count || julyTotals?.total !== expected.july.total) {
      throw new Error(`unexpected July forecast result: ${JSON.stringify(julyTotals)}`);
    }
    const change = julyTotals.total - juneTotals.total;
    const percent = Math.round((Math.abs(change) / juneTotals.total) * 100);
    const direction =
      change < 0 ? `减少 ${-change}，约下降${percent}%` : `增加 ${change}，约上升${percent}%`;
    return `7月份共有 ${julyTotals.count} 条需求预测，需求总量为 ${julyTotals.total}；相比6月${direction}。`;
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
      max_concepts: 20,
      bkn_context: businessContext(interaction.interaction_id),
    },
  );
  const binding = extractSalesOrderBinding(schemaCall.value);
  // A query the compiler refuses (variable-length path), so the call fails with a durable receipt.
  const rejectedCall = await managedRejectedOperation(
    interaction.interaction_id,
    "sales-orders:unsupported-rejection",
    "run_cypher",
    {
      kn_id: knId,
      query: `MATCH (s:${quoteIdentifier(binding.objectTypeId)})-[*1..2]-(x) RETURN s LIMIT 1`,
      response_format: "json",
      bkn_context: businessContext(interaction.interaction_id),
    },
  );
  const dataCall = await managedOperation(
    interaction.interaction_id,
    "sales-orders:data",
    "run_cypher",
    {
      query: buildSalesOrderCypher(binding),
      response_format: "json",
      bkn_context: businessContext(interaction.interaction_id),
    },
  );
  const rows = extractRows(dataCall.value);
  const orderCount = rows.reduce((sum, row) => sum + Number(row.order_count ?? 0), 0);
  const signingQuantity = rows.reduce((sum, row) => sum + Number(row.signing_quantity ?? 0), 0);
  if (
    rows.length !== expected.salesOrders.products ||
    orderCount !== expected.salesOrders.orders ||
    signingQuantity !== expected.salesOrders.quantity
  ) {
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

async function runInteraction({ key, question, start, until, answerFor }) {
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
      max_concepts: 20,
      bkn_context: businessContext(interaction.interaction_id),
    },
  );
  const binding = extractForecastBinding(schemaCall.value);
  const dataCall = await managedOperation(interaction.interaction_id, `${key}:data`, "run_cypher", {
    ...buildForecastCypher(binding, start, until),
    response_format: "json",
    bkn_context: businessContext(interaction.interaction_id),
  });
  const rows = extractRows(dataCall.value);
  if (rows.length === 0) throw new Error(`run_cypher returned no rows for ${key}`);

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
      agent_name: agentName,
      question,
      ...(conversationId
        ? { conversation_mode: "continue", conversation_id: conversationId }
        : { conversation_mode: "new" }),
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
  const objectTypeId = selected.item.id ?? selected.item.object_type_id ?? selected.item.concept_id;
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
  if (!resourceId || !objectTypeId) throw new Error("forecast schema binding is incomplete");
  return {
    resourceId,
    objectTypeId,
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
  const objectTypeId = selected.concept_id ?? selected.id;
  if (!objectTypeId) throw new Error("sales order schema binding is missing its object type");
  return {
    objectTypeId,
    productCode: propertyBinding(selected.data_properties, ["product_code"]),
    productName: propertyBinding(selected.data_properties, ["product_name"]),
    signingQuantity: propertyBinding(selected.data_properties, ["signing_quantity"]),
  };
}

function buildSalesOrderCypher(binding) {
  const property = ({ logicalName }) => `s.${quoteIdentifier(logicalName)}`;
  return [
    `MATCH (s:${quoteIdentifier(binding.objectTypeId)})`,
    `RETURN ${property(binding.productCode)} AS product_code,`,
    `max(${property(binding.productName)}) AS product_name,`,
    "count(*) AS order_count,",
    `sum(${property(binding.signingQuantity)}) AS signing_quantity`,
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
  if (!property) throw new Error(`schema is missing one of: ${logicalNames.join(", ")}`);
  return { logicalName: property.name };
}

// Lists the forecasts of the period; counts and totals per month are computed from the rows.
function buildForecastCypher(binding, start, until) {
  const returned = [binding.product, binding.order, binding.demand, binding.month]
    .map(
      ({ logicalName }) => `f.${quoteIdentifier(logicalName)} AS ${quoteIdentifier(logicalName)}`,
    )
    .join(", ");
  const month = `f.${quoteIdentifier(binding.month.logicalName)}`;
  return {
    query: [
      `MATCH (f:${quoteIdentifier(binding.objectTypeId)})`,
      `WHERE ${month} >= date($period_start) AND ${month} < date($period_until)`,
      `RETURN ${returned}`,
      `ORDER BY ${quoteIdentifier(binding.month.logicalName)}, ${quoteIdentifier(binding.product.logicalName)}`,
    ].join(" "),
    parameters: { period_start: start, period_until: until },
  };
}

function aggregateByMonth(rows, binding) {
  const result = {};
  for (const row of rows) {
    const month = String(row[binding.month.logicalName] ?? "").slice(0, 7);
    if (!month) continue;
    result[month] ??= { count: 0, total: 0 };
    result[month].count += 1;
    result[month].total += Number(row[binding.demand.logicalName] ?? 0);
  }
  return result;
}

function extractRows(value) {
  if (Array.isArray(value?.entries)) return value.entries;
  if (Array.isArray(value?.data?.entries)) return value.data.entries;
  throw new Error("run_cypher response does not contain entries");
}

function walk(value, visitor) {
  if (!value || typeof value !== "object") return;
  if (!Array.isArray(value)) visitor(value);
  for (const child of Array.isArray(value) ? value : Object.values(value)) walk(child, visitor);
}

function quoteIdentifier(value) {
  return `\`${String(value).replaceAll("`", "``")}\``;
}

function numeric(value, fallback) {
  const parsed = Number(value);
  return value !== undefined && value !== "" && Number.isFinite(parsed) ? parsed : fallback;
}

function assertString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`managed lifecycle response is missing ${name}`);
  }
}
