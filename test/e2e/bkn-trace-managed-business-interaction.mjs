#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { createClient } from "../../dist/index.js";

const baseUrl = process.env.BKN_BASE_URL ?? "http://localhost";
const businessDomain = process.env.BKN_BUSINESS_DOMAIN ?? "bd_public";
const knId = process.env.BKN_KN_ID ?? "supplychain_hd0202";
const runId = randomBytes(8).toString("hex");
const client = createClient({ baseUrl, businessDomain });

const conversation = await client.context.toolCall(knId, "bkn_create_conversation", {
  external_conversation_key: `sdk-supply-chain-${runId}`,
  idempotency_key: `create-${runId}`,
});
assertString(conversation?.conversation_id, "conversation_id");

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

const interactions = [june, comparison];
const operations = interactions.flatMap((item) => item.operations);
if (interactions.length !== 2 || operations.length < 4) {
  throw new Error(
    `invalid provenance hierarchy: interactions=${interactions.length}, operations=${operations.length}`,
  );
}

console.log(
  JSON.stringify(
    {
      passed: true,
      conversation_id: conversation.conversation_id,
      expected_view_counts: { conversations: 1, interactions: 2, openbkn_calls: operations.length },
      interactions,
    },
    null,
    2,
  ),
);

async function runInteraction({ key, question, start, end, answerFor }) {
  const interaction = await client.context.toolCall(knId, "bkn_start_interaction", {
    conversation_id: conversation.conversation_id,
    idempotency_key: `interaction-${key}-${runId}`,
    question,
  });
  assertString(interaction?.interaction_id, "interaction_id");
  assertString(interaction?.lease_token, "lease_token");

  const schemaCall = await operationClient().context.managedToolCall(knId, "search_schema", {
    query: question,
    response_format: "json",
    include_columns: true,
    max_concepts: 20,
    bkn_context: businessContext(interaction.interaction_id, `${key}-schema-search`),
  });
  const binding = extractForecastBinding(schemaCall.value);
  const dataCall = await operationClient().context.managedToolCall(knId, "run_sql", {
    sql: buildForecastSql(binding, start, end),
    response_format: "json",
    bkn_context: businessContext(interaction.interaction_id, `${key}-forecast-query`),
  });
  const rows = extractRows(dataCall.value);
  if (rows.length === 0) throw new Error(`run_sql returned no rows for ${key}`);

  const answer = answerFor(rows, binding);
  const receipts = [schemaCall.receipt, dataCall.receipt];
  const completed = await client.context.toolCall(knId, "bkn_complete_interaction", {
    interaction_id: interaction.interaction_id,
    terminal_idempotency_key: `complete-${key}-${runId}`,
    lease_token: interaction.lease_token,
    lease_epoch: interaction.lease_epoch,
    completion_manifest_version: "3.0.0",
    completion_reason: "answered",
    answer,
    expected_operations: receipts.map((receipt) => ({
      operation_id: receipt.operation_id,
      required: true,
    })),
    expected_receipts: receipts.map((receipt) => ({
      receipt_id: receipt.receipt_id,
      required: true,
    })),
  });
  return {
    interaction_id: interaction.interaction_id,
    question,
    answer,
    execution_status: completed.execution_status,
    evidence_status: completed.evidence_status,
    operations: receipts.map((receipt) => ({
      operation_id: receipt.operation_id,
      operation_key: receipt.operation_key,
      tool_name: receipt.tool_name,
      receipt_id: receipt.receipt_id,
      trace_id: receipt.trace_id,
      request_id: receipt.request_id,
      evidence_durability: receipt.evidence_durability,
      business_refs: receipt.business_refs,
    })),
  };
}

function operationClient() {
  return createClient({ baseUrl, businessDomain });
}

function businessContext(interactionId, operationKey) {
  return {
    conversation_id: conversation.conversation_id,
    interaction_id: interactionId,
    operation_key: operationKey,
  };
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
  return { resourceId, month, demand, product, order };
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
