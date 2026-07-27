import { createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { type EvidenceIngestRequest, TraceSession, createClient } from "../src/index.js";

const dryRun = process.argv.includes("--dry-run");
const outputArg = process.argv.indexOf("--out");
const outputPath = outputArg >= 0 ? process.argv[outputArg + 1] : undefined;
if (!dryRun) {
  throw new Error(
    "This contract example is dry-run only; production events must wrap real operations",
  );
}

function hash(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

const client = createClient({
  baseUrl: process.env.OPENBKN_BASE_URL ?? "http://127.0.0.1",
  token: process.env.OPENBKN_TOKEN ?? "dry-run-not-sent",
  businessDomain: process.env.OPENBKN_BUSINESS_DOMAIN ?? "bd_public",
});
const traceContext = client.ctx.trace;
if (!traceContext) throw new Error("BKN Trace context was not initialized");

const traceId = traceContext.traceparent.split("-")[1];
if (!traceId) throw new Error("Generated traceparent does not contain a trace id");

let captured: EvidenceIngestRequest | undefined;
const session = new TraceSession({
  trace: {
    trace_id: traceId,
    traceparent: traceContext.traceparent,
    "bkn.request.id": traceContext.requestId,
    business_domain: client.ctx.businessDomain,
    "bkn.account.id": process.env.OPENBKN_ACCOUNT_ID ?? "account_sdk_example",
    "bkn.account.type": "app",
  },
  producerModule: "third-party-business-agent",
  spanId: randomBytes(8).toString("hex"),
  emit: async (body) => {
    captured = body;
    return {
      trace_id: body.trace.trace_id,
      "bkn.request.id": body.trace["bkn.request.id"],
      "bkn.trace.schema.version": body["bkn.trace.schema.version"],
      accepted_event_count: body.events.length,
      claim_count: 1,
      evidence_ref_count: 2,
      business_ref_count: 3,
    };
  },
});

const interaction = session.startInteraction({
  operationName: "supplychain.shortage.assess",
  intentHash: hash("评估关键物料短缺风险并创建监控任务"),
  mode: "task",
  appRef: "app:sdk-business-agent-example",
});
const retrieval = session.observeOperation("retrieval.completed", {
  operationName: "supplychain.knowledge.retrieve",
  causationEventId: interaction.event_id,
  payload: {
    query_hash: hash("关键物料、供应商与库存关系"),
    candidate_count: 3,
    truncated: false,
    version_status: "versioned",
  },
});
const knowledge = session.observeOperation("knowledge.read.observed", {
  operationName: "supplychain.knowledge.read",
  causationEventId: retrieval.event_id,
  payload: {
    kn_id: "supplychain",
    read_kind: "object_relation_schema",
    version_status: "versioned",
    schema_version: "supplychain:v3",
    business_refs: ["object-type:material", "object-type:supplier", "relation-type:supplied_by"],
  },
});
const data = session.observeOperation("data.query.observed", {
  operationName: "supplychain.inventory.aggregate",
  causationEventId: knowledge.event_id,
  payload: {
    query_hash: hash("按物料汇总可用库存和未来七日需求"),
    query_type: "aggregate",
    row_count: 2,
    resource_refs: ["data-view:material-availability:v5"],
    version_status: "versioned",
  },
});
const model = session.observeOperation("model.call.observed", {
  operationName: "supplychain.risk.reason",
  causationEventId: data.event_id,
  payload: {
    model_name: "risk-reasoner-v1",
    model_provider: "openai-compatible",
    input_token_count: 420,
    output_token_count: 96,
    prompt_hash: hash("knowledge-and-data-refs"),
    output_hash: hash("material-M-1001-shortage-risk"),
    status: "ok",
  },
});
const claim = session.createClaim({
  operationName: "supplychain.claim.create",
  causationEventId: model.event_id,
  claimId: "claim_material_M_1001_shortage",
  claimType: "recommendation",
  claimHash: hash("物料 M-1001 存在七日内短缺风险，建议创建监控任务"),
  sourceEventIds: [knowledge.event_id, data.event_id, model.event_id],
  operationIds: [
    knowledge.operation_id as string,
    data.operation_id as string,
    model.operation_id as string,
  ],
  versionStatus: "versioned",
});
const evidence = session.createEvidenceRefs({
  operationName: "supplychain.evidence.link",
  claimId: claim.claim_id as string,
  refs: [
    {
      refId: "evidence:knowledge:supplychain-v3",
      refType: "knowledge_network",
      sourceSystem: "bkn",
      validity: "available",
      versionStatus: "versioned",
      visibility: "visible",
      summaryHash: hash("kn:supplychain:v3"),
    },
    {
      refId: "evidence:data:material-availability-v5",
      refType: "data_resource",
      sourceSystem: "vega",
      validity: "observed",
      versionStatus: "versioned",
      visibility: "visible",
      summaryHash: hash("data-view:material-availability:v5"),
    },
  ],
});
session.resolveBusinessRefs({
  operationName: "supplychain.business.resolve",
  claimId: claim.claim_id as string,
  causationEventId: evidence.event_id,
  resolverStatus: "resolved",
  refs: [
    {
      refId: "object:material:M-1001",
      refType: "object",
      sourceSystem: "bkn",
      validity: "available",
      versionStatus: "versioned",
      visibility: "visible",
    },
    {
      refId: "property:material:available_quantity",
      refType: "property",
      sourceSystem: "bkn",
      validity: "available",
      versionStatus: "versioned",
      visibility: "visible",
    },
    {
      refId: "relation:material:M-1001:supplier:S-2001",
      refType: "relation",
      sourceSystem: "bkn",
      validity: "available",
      versionStatus: "versioned",
      visibility: "visible",
    },
  ],
});
const action = session.recommendAction({
  operationName: "supplychain.monitor.recommend",
  claimId: claim.claim_id as string,
  actionType: "create_shortage_monitor",
  targetRefs: ["object:material:M-1001"],
  reasonHash: hash("claim_material_M_1001_shortage"),
});
session.requestActionApproval(action, { policyRef: "policy:reversible-monitor-task" });
session.approveAction(action, {
  actorRef: "account:example-approver",
  policyDecisionRef: "policy-decision:allow-monitor-task",
});
session.executeAction(action, {
  status: "ok",
  invocationRef: "tool:create-shortage-monitor",
});
session.recordActionResult(action, {
  status: "created",
  resultHash: hash("monitor-task-created"),
  taskRef: "monitor-task:dry-run-001",
});

await session.flush();

if (!captured) throw new Error("No BKN Trace event batch was produced");
const fixture = {
  fixture_id: "sdk_third_party_business_agent_2_1",
  "bkn.trace.schema.version": "2.1.0",
  expected_result: "pass",
  trace: captured.trace,
  baggage: { "bkn.account.type": "app" },
  spans: [
    {
      span_id: captured.events[0]?.span_id,
      parent_span_id: null,
      name: "third-party-business-agent",
      "bkn.module.name": "third-party-business-agent",
      "bkn.operation.name": "supplychain.shortage.assess",
      "bkn.status": "ok",
      "bkn.timestamp": captured.events[0]?.observed_at,
    },
  ],
  logs: [],
  events: captured.events,
};
const serialized = `${JSON.stringify(fixture, null, 2)}\n`;
if (outputPath) writeFileSync(outputPath, serialized);
else process.stdout.write(serialized);
