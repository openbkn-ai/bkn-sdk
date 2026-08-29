// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * Deploy probing — which commands this platform can actually answer.
 *
 * Deploys differ: a community build has no `admin audit list`, an MCP server
 * that advertises no prompts cannot serve `context prompts`, and a service can
 * simply be absent. A caller discovers that today by running the command and
 * reading the refusal. Probing asks the questions once, cheaply and read-only,
 * so `describe` can say up front what will not work here.
 *
 * Every answer is one of three, never a guess dressed as a fact: available,
 * unavailable with the reason, or unknown because nothing was checked.
 */
import type { Command } from "commander";
import { clientFrom } from "./_shared.js";

/** One cheap read per service; its result decides every command behind it. */
const SERVICE_PROBES: Array<{ service: string; path: string }> = [
  { service: "bkn-backend", path: "/api/bkn-backend/v1/knowledge-networks?limit=1" },
  { service: "vega-backend", path: "/api/vega-backend/v1/catalogs?limit=1" },
  {
    service: "agent-operator-integration",
    path: "/api/agent-operator-integration/v1/tool-box/list?page=1&size=1",
  },
  { service: "agent-observability", path: "/api/agent-observability/v1/conversations?limit=1" },
  { service: "mf-model-manager", path: "/api/mf-model-manager/v1/llm/list" },
  { service: "safe", path: "/api/safe/v1/me/api-keys" },
  { service: "agent-retrieval", path: "/api/agent-retrieval/v1/mcp/info" },
];

/** Which service answers a command, by the path its group sits on. */
const COMMAND_SERVICE: Array<[RegExp, string]> = [
  [/^bkn\b/, "bkn-backend"],
  [/^vega\b/, "vega-backend"],
  [/^resource\b/, "vega-backend"],
  [/^context\b/, "agent-retrieval"],
  [/^trace\b/, "agent-observability"],
  [/^(skill|toolbox|tool|function|operator)\b/, "agent-operator-integration"],
  [/^model\b/, "mf-model-manager"],
  [/^(auth|appkey)\b/, "safe"],
  [/^admin (llm|small-model)\b/, "mf-model-manager"],
  [/^admin\b/, "safe"],
];

/** Context commands that stand on one MCP tool, so the catalog decides them. */
const COMMAND_TOOL: Record<string, string> = {
  "context search-schema": "search_schema",
  "context query-object-instance": "query_object_instance",
  "context query-instance-subgraph": "query_instance_subgraph",
  "context explore-subgraph": "explore_subgraph",
  "context run-sql": "run_sql",
  "context query-metric": "query_metric",
  "context get-logic-properties": "get_logic_properties_values",
  "context get-action-info": "get_action_info",
  "context find-skills": "find_skills",
  "context kn-detail": "get_kn_detail",
  "context object-types": "get_object_types",
  "context relation-types": "get_relation_types",
};

export interface ProbeResult {
  baseUrl: string;
  checkedAt: string;
  services: Record<string, { available: boolean; reason?: string }>;
  mcpTools: string[];
}

export type Availability = { available: boolean | "unknown"; reason?: string };

/** Read-only, one request per service. A failure is data, not an error. */
export async function probeDeploy(cmd: Command, now: string): Promise<ProbeResult> {
  const client = clientFrom(cmd);
  const services: ProbeResult["services"] = {};
  for (const { service, path } of SERVICE_PROBES) {
    try {
      const res = await client.call(path);
      // A 400 or 403 means the service answered — the probe's own arguments were
      // wrong, or this caller lacks rights. Only a missing route or a service
      // that cannot be reached says the command will not work here.
      services[service] =
        res.status === 404 || res.status === 501 || res.status >= 502
          ? { available: false, reason: `HTTP ${res.status} ${res.statusText}`.trim() }
          : { available: true };
    } catch (err) {
      services[service] = {
        available: false,
        reason: err instanceof Error ? firstLine(err.message) : "unreachable",
      };
    }
  }

  let mcpTools: string[] = [];
  if (services["agent-retrieval"]?.available) {
    try {
      const info = (await client.context.info()) as { tools?: Array<string | { name?: string }> };
      mcpTools = (info.tools ?? [])
        .map((t) => (typeof t === "string" ? t : (t.name ?? "")))
        .filter(Boolean);
    } catch {
      // The service answered but the catalog did not; tool-level checks stay unknown.
    }
  }
  return { baseUrl: client.ctx.baseUrl, checkedAt: now, services, mcpTools };
}

/** The part of a failure worth carrying: its first line, trimmed. */
function firstLine(message: string): string {
  return (message.split("\n")[0] ?? message).slice(0, 160);
}

/** What the probe says about one command path. */
export function availabilityOf(path: string, probe: ProbeResult | undefined): Availability {
  if (!probe) return { available: "unknown" };

  const tool = COMMAND_TOOL[path];
  if (tool && probe.mcpTools.length) {
    return probe.mcpTools.includes(tool)
      ? { available: true }
      : { available: false, reason: `this deploy's MCP server does not advertise ${tool}` };
  }

  const service = COMMAND_SERVICE.find(([re]) => re.test(path))?.[1];
  // `config` and `call` talk to no single service: one is local, the other is
  // whatever the caller points it at.
  if (!service) return { available: "unknown", reason: "no single service to check" };
  const state = probe.services[service];
  if (!state) return { available: "unknown" };
  return state.available
    ? { available: true }
    : { available: false, reason: `${service}: ${state.reason ?? "unreachable"}` };
}
