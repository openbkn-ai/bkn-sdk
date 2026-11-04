import { describe, expect, it } from "vitest";
import { type ProbeResult, availabilityOf } from "../../src/commands/probe.js";

function probe(services: ProbeResult["services"]): ProbeResult {
  return { baseUrl: "https://x", checkedAt: "now", services, mcpTools: [] };
}

describe("describe --probe service mapping", () => {
  it("judges admin audit by the observability service, not bkn-safe", () => {
    const p = probe({
      safe: { available: true },
      observability: { available: false, reason: "HTTP 404 Not Found" },
    });
    expect(availabilityOf("admin audit list", p)).toEqual({
      available: false,
      reason: "observability: HTTP 404 Not Found",
    });
    expect(availabilityOf("admin user list", p)).toEqual({ available: true });
  });

  it("keeps admin audit available when bkn-safe is down but observability answers", () => {
    const p = probe({
      safe: { available: false, reason: "unreachable" },
      observability: { available: true },
    });
    expect(availabilityOf("admin audit get", p)).toEqual({ available: true });
  });
});
