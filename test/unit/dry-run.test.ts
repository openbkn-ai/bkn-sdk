import { describe, expect, it } from "vitest";
import { DryRunSignal, enableDryRun, previewRequest } from "../../src/utils/dry-run.js";

function preview(input: Parameters<typeof previewRequest>[0]) {
  enableDryRun();
  try {
    previewRequest(input);
  } catch (err) {
    if (err instanceof DryRunSignal) return err.request;
    throw err;
  }
  throw new Error("preview did not stop the request");
}

describe("--dry-run preview", () => {
  it("redacts the header that identifies the caller", () => {
    const req = preview({
      method: "GET",
      url: "https://x/api/y",
      headers: { authorization: "Bearer ory_at_secret", "x-business-domain": "bd_public" },
    });
    expect(req.headers.authorization).toBe("<redacted>");
    expect(req.headers["x-business-domain"]).toBe("bd_public");
  });

  it("redacts a credential carried as a body field, not only as a header", () => {
    // `function run --pass-token` puts one in `bkn_token`, and a preview is
    // something a caller pastes into a terminal, an issue, or a log.
    const req = preview({
      method: "POST",
      url: "https://x/api/y",
      body: JSON.stringify({
        code: "print(1)",
        bkn_token: "ory_at_secret",
        bkn_conversation_id: "conv-1",
      }),
    });
    const body = req.body as Record<string, unknown>;
    expect(body.bkn_token).toBe("<redacted>");
    expect(body.code).toBe("print(1)");
    expect(body.bkn_conversation_id).toBe("conv-1");
  });

  it("reaches a credential nested inside the body", () => {
    const req = preview({
      method: "POST",
      url: "https://x/api/y",
      body: { items: [{ name: "a", password: "hunter2" }] },
    });
    expect(req.body).toEqual({ items: [{ name: "a", password: "<redacted>" }] });
  });
});
