#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { createClient } from "../../dist/index.js";

const question = "6月份有哪些需求预测单，列出来，需求总量是多少？";
const baseUrl = process.env.BKN_BASE_URL ?? "http://localhost";
const token = process.env.BKN_TOKEN;
const accountId = requiredEnv("BKN_ACCOUNT_ID");
const accountType = process.env.BKN_ACCOUNT_TYPE ?? "user";
const knId = process.env.BKN_KN_ID ?? "supplychain_hd0202";
const forecastYear = numeric(process.env.BKN_FORECAST_YEAR, 2026);
const expectedForecastCount = numeric(process.env.BKN_EXPECTED_FORECAST_COUNT, 63);
const expectedTotalDemand = numeric(process.env.BKN_EXPECTED_TOTAL_DEMAND, 11_594);
const runId = randomBytes(8).toString("hex");
const conversationId = process.env.BKN_CONVERSATION_ID ?? `conversation_supplychain_${runId}`;
const interactionId = process.env.BKN_INTERACTION_ID ?? `interaction_june_forecast_${runId}`;
const agentRef = process.env.BKN_AGENT_REF ?? "app:sdk-bkn-trace-e2e";

const schemaClient = operationClient("schema");
const schema = await schemaClient.context.toolCall(knId, "search_schema", {
  query: question,
  response_format: "json",
  include_columns: true,
  max_concepts: 20,
});
const schemaBinding = extractForecastBinding(schema);

const sql = buildForecastSql(schemaBinding, forecastYear);
const dataClient = operationClient("data");
const dataResult = await dataClient.context.toolCall(knId, "run_sql", {
  sql,
  response_format: "json",
});
const rows = extractRows(dataResult);
if (rows.length === 0) throw new Error("run_sql returned no June forecast rows");

const forecastCount = numeric(rows[0]?.forecast_count, rows.length);
const totalDemand = numeric(rows[0]?.total_demand);
if (!Number.isFinite(totalDemand)) {
  throw new Error("run_sql did not return a numeric total_demand");
}
assert(
  forecastCount === expectedForecastCount,
  `forecast count mismatch: expected=${expectedForecastCount} actual=${forecastCount}`,
);
assert(
  totalDemand === expectedTotalDemand,
  `total demand mismatch: expected=${expectedTotalDemand} actual=${totalDemand}`,
);
const answer = {
  summary: `6月份共有 ${forecastCount} 条需求预测，需求总量为 ${totalDemand}。`,
  forecast_count: forecastCount,
  total_demand: totalDemand,
  forecasts: rows.map(({ forecast_count, total_demand, ...row }) => row),
};

const evidenceClient = operationClient("evidence");
const evidenceIdentity = identityOf(evidenceClient);
const refs = {
  object: `object:${knId}:${schemaBinding.objectTypeId}`,
  resource: `resource:${schemaBinding.resourceId}`,
  month: `property:${knId}:${schemaBinding.objectTypeId}:${schemaBinding.month.logicalName}`,
  demand: `property:${knId}:${schemaBinding.objectTypeId}:${schemaBinding.demand.logicalName}`,
};
const artifacts = {
  question: artifact("question", question, [refs.object]),
  query: artifact("query", { language: "trino", sql }, [refs.resource, refs.month, refs.demand]),
  data: artifact("data_result", dataResult, [refs.resource, refs.object]),
  logic: artifact(
    "logic_execution",
    {
      formula: "COUNT(rows), SUM(consensus_demand)",
      forecast_count: forecastCount,
      total_demand: totalDemand,
    },
    [refs.object, refs.demand],
  ),
  result: artifact("result", answer, [refs.object, refs.resource, refs.month, refs.demand]),
};
for (const value of Object.values(artifacts)) {
  await evidenceClient.trace.emitArtifact(value);
}

const session = evidenceClient.trace.createSession({
  trace: {
    trace_id: evidenceIdentity.traceId,
    traceparent: evidenceIdentity.traceparent,
    "bkn.request.id": evidenceIdentity.requestId,
    "bkn.conversation.id": conversationId,
    "bkn.account.id": accountId,
    "bkn.account.type": accountType,
  },
  producerModule: "sdk-bkn-trace-business-e2e",
  spanId: evidenceIdentity.spanId,
  conversationId,
  interactionId,
  contractVersion: "2.2.0",
});
const interaction = session.startInteraction({
  operationName: "supplychain.forecast.answer",
  intentHash: hash(question),
  mode: "task",
  appRef: agentRef,
  questionArtifactRef: artifactRef(artifacts.question),
});
const retrieval = session.observeOperation("retrieval.completed", {
  operationName: "supplychain.schema.retrieve",
  causationEventId: interaction.event_id,
  payload: {
    query_hash: hash(question),
    candidate_count: countSchemaConcepts(schema),
    truncated: false,
    version_status: "versioned",
    source_refs: [`kn:${knId}`],
  },
});
const knowledge = session.observeOperation("knowledge.read.observed", {
  operationName: "supplychain.forecast.schema.read",
  causationEventId: retrieval.event_id,
  payload: {
    kn_id: knId,
    read_kind: "object_property_resource_schema",
    version_status: "versioned",
    business_refs: [refs.object, refs.month, refs.demand, refs.resource],
  },
});
const data = session.observeOperation("data.query.observed", {
  operationName: "supplychain.forecast.june.query",
  causationEventId: knowledge.event_id,
  payload: {
    query_hash: hash(sql),
    query_type: "aggregate_and_list",
    row_count: forecastCount,
    truncated: false,
    version_status: "versioned",
    resource_refs: [refs.resource],
    field_refs: [refs.month, refs.demand],
    query_artifact_ref: artifactRef(artifacts.query),
    result_artifact_ref: artifactRef(artifacts.data),
  },
});
const logic = session.observeOperation("logic.execution.observed", {
  operationName: "supplychain.forecast.total.calculate",
  causationEventId: data.event_id,
  payload: {
    logic_ref: "logic:supplychain:count_and_sum_forecast",
    input_artifact_ref: artifactRef(artifacts.data),
    result_artifact_ref: artifactRef(artifacts.logic),
    status: "success",
  },
});
const claim = session.createClaim({
  operationName: "supplychain.forecast.answer.create",
  causationEventId: logic.event_id,
  claimId: `claim_june_forecast_${runId}`,
  claimType: "answer",
  claimHash: hash(answer),
  sourceEventIds: [knowledge.event_id, data.event_id, logic.event_id],
  operationIds: [knowledge.operation_id, data.operation_id, logic.operation_id],
  resultArtifactRef: artifactRef(artifacts.result),
  versionStatus: "versioned",
});
const evidence = session.createEvidenceRefs({
  operationName: "supplychain.forecast.evidence.link",
  claimId: claim.claim_id,
  refs: [
    evidenceRef(`evidence:kn:${knId}`, "knowledge_network", "bkn"),
    evidenceRef(`evidence:resource:${schemaBinding.resourceId}`, "data_resource", "vega"),
  ],
});
session.resolveBusinessRefs({
  operationName: "supplychain.forecast.business.resolve",
  claimId: claim.claim_id,
  causationEventId: evidence.event_id,
  resolverStatus: "resolved",
  refs: [
    businessRef(refs.object, "object"),
    businessRef(refs.month, "property"),
    businessRef(refs.demand, "property"),
    businessRef(refs.resource, "resource"),
  ],
});
await session.flush();

const queryClient = createClient({
  baseUrl,
  ...(token ? { token } : {}),
  insecure: envFlag("BKN_INSECURE"),
});
const expectedRequestIds = [
  schemaClient.ctx.trace.requestId,
  dataClient.ctx.trace.requestId,
  evidenceIdentity.requestId,
];
const summary = await pollInteraction(queryClient, expectedRequestIds);
const evidenceChain = await queryClient.trace.evidenceChain(
  { requestId: evidenceIdentity.requestId },
  { limit: 500 },
);
const storedQuestion = await queryClient.trace.artifact(artifacts.question.artifact_id);
const storedResult = await queryClient.trace.artifact(artifacts.result.artifact_id);

assert(summary.conversation_id === conversationId, "conversation id was not preserved");
assert(summary.status === "completed", `interaction status is not completed: ${summary.status}`);
assert(summary.requests.length >= 3, "interaction must aggregate at least three requests");
assert(summary.traces.length >= 3, "interaction must aggregate at least three traces");
assert(
  expectedRequestIds.every((id) => summary.requests.some((item) => item.request_id === id)),
  "interaction is missing one or more SDK request ids",
);
assert((evidenceChain.data.claims ?? []).length > 0, "evidence chain has no claim");
assert((evidenceChain.data.evidence_refs ?? []).length >= 2, "evidence chain is incomplete");
assert(storedQuestion.content === question, "question artifact content is not readable");
assert(
  storedResult.content?.total_demand === totalDemand,
  "result artifact content is not readable",
);

console.log(
  JSON.stringify(
    {
      passed: true,
      conversation_id: conversationId,
      interaction_id: interactionId,
      request_ids: expectedRequestIds,
      trace_ids: [
        identityOf(schemaClient).traceId,
        identityOf(dataClient).traceId,
        evidenceIdentity.traceId,
      ],
      question,
      answer,
      interaction: {
        status: summary.status,
        request_count: summary.requests.length,
        trace_count: summary.traces.length,
      },
    },
    null,
    2,
  ),
);

function operationClient(name) {
  return createClient({
    baseUrl,
    ...(token ? { token } : {}),
    insecure: envFlag("BKN_INSECURE"),
    trace: {
      requestId: `req_e2e_${runId}_${name}`,
      conversationId,
      interactionId,
      operationId: `op_e2e_${runId}_${name}`,
    },
  });
}

function identityOf(client) {
  const trace = client.ctx.trace;
  if (!trace) throw new Error("SDK trace context is missing");
  const [, traceId, spanId] = trace.traceparent.split("-");
  if (!traceId || !spanId) throw new Error("SDK traceparent is invalid");
  return { requestId: trace.requestId, traceparent: trace.traceparent, traceId, spanId };
}

function artifact(type, content, businessRefs) {
  const id = `art_${type}_${runId}`;
  return {
    artifact_id: id,
    artifact_type: type,
    "bkn.request.id": evidenceIdentity.requestId,
    trace_id: evidenceIdentity.traceId,
    interaction_id: interactionId,
    business_refs: businessRefs,
    content_type: "application/json",
    schema_version: "2.2.0",
    observed_at: new Date().toISOString(),
    content_hash: hash(content),
    content,
    "bkn.account.id": accountId,
    "bkn.account.type": accountType,
    initiator: `account:${accountId}`,
    agent_or_app: agentRef,
  };
}

function artifactRef(value) {
  return `artifact:${value.artifact_id}`;
}

function evidenceRef(refId, refType, sourceSystem) {
  return {
    refId,
    refType,
    sourceSystem,
    validity: "observed",
    versionStatus: "versioned",
    visibility: "visible",
  };
}

function businessRef(refId, refType) {
  return {
    refId,
    refType,
    sourceSystem: refType === "resource" ? "vega" : "bkn",
    validity: "available",
    versionStatus: "versioned",
    visibility: "visible",
  };
}

async function pollInteraction(client, requestIds) {
  let latest;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      latest = await client.trace.interactions.get(interactionId);
      const complete = requestIds.every((id) =>
        latest.requests.some((item) => item.request_id === id),
      );
      if (complete && latest.traces.length >= requestIds.length) return latest;
    } catch (error) {
      if (error?.status !== 404) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`interaction summary did not converge: ${JSON.stringify(latest)}`);
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
  return { resourceId, objectTypeId, month, demand, product, order };
}

function hasProperty(properties, logicalNames) {
  return properties.some((property) => logicalNames.includes(property.name));
}

function propertyBinding(properties, logicalNames) {
  const property = logicalNames
    .map((logicalName) => properties.find((item) => item.name === logicalName))
    .find(Boolean);
  if (!property) throw new Error(`forecast schema is missing one of: ${logicalNames.join(", ")}`);
  const column = property.column ?? property.mapped_field ?? property.name;
  return { logicalName: property.name, column };
}

function buildForecastSql(binding, year) {
  const columns = [binding.product, binding.order, binding.demand, binding.month].map(
    ({ column }) => quoteIdentifier(column),
  );
  const month = quoteIdentifier(binding.month.column);
  const demand = quoteIdentifier(binding.demand.column);
  const periodStart = `${year}-06-01`;
  const periodEnd = `${year}-07-01`;
  return [
    `SELECT ${columns.join(", ")},`,
    "COUNT(*) OVER () AS forecast_count,",
    `SUM(CAST(${demand} AS DOUBLE)) OVER () AS total_demand`,
    `FROM {{.${binding.resourceId}}}`,
    `WHERE ${month} >= '${periodStart}' AND ${month} < '${periodEnd}'`,
    `ORDER BY ${month}, ${quoteIdentifier(binding.product.column)}`,
  ].join(" ");
}

function extractRows(value) {
  if (Array.isArray(value?.entries)) return value.entries;
  if (Array.isArray(value?.data?.entries)) return value.data.entries;
  throw new Error("run_sql response does not contain entries");
}

function countSchemaConcepts(value) {
  return ["object_types", "relation_types", "action_types", "metric_types"].reduce(
    (count, key) => count + (Array.isArray(value?.[key]) ? value[key].length : 0),
    0,
  );
}

function walk(value, visitor) {
  if (!value || typeof value !== "object") return;
  if (!Array.isArray(value)) visitor(value);
  for (const child of Array.isArray(value) ? value : Object.values(value)) walk(child, visitor);
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function numeric(value, fallback = Number.NaN) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hash(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function envFlag(name) {
  return /^(1|true|yes)$/i.test(process.env[name] ?? "");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
