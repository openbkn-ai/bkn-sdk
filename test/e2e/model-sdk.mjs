// Focused live SDK/CLI checks using existing models; no registry changes or tool execution.
// Required: BKN_BASE_URL, BKN_LLM_ID. Optional: BKN_SMALL_MODEL_ID, BKN_MODEL_TOOLS=1.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createClient } from "../../dist/index.js";

const baseUrl = process.env.BKN_BASE_URL;
const id = process.env.BKN_LLM_ID;
assert(baseUrl && id, "Set BKN_BASE_URL and BKN_LLM_ID to an existing model");
const c = createClient({ baseUrl, insecure: process.env.BKN_INSECURE === "1" });
const detail = await c.models.llm.get(id);
const model = detail?.data ?? detail;
assert(model?.model_name, "Existing model name was not returned");
const name = model.model_name;
const options = { temperature: 0, maxTokens: 64, timeoutMs: 90_000 };
const messages = [{ role: "user", content: "Reply only SDK_MODEL_OK. Do not explain." }];
const checks = [];
const result = await c.models.llm.chat(name, messages, options);
assert(result.choices?.[0]?.message?.content?.trim(), "Non-stream completion had no text");
checks.push({ check: "sdk-chat-name-options", passed: true });
let delta = "";
let chunks = 0;
const full = await c.models.llm.chatStream(
  id,
  messages,
  (text) => {
    delta += text;
  },
  {
    ...options,
    onChunk: () => {
      chunks++;
    },
  },
);
assert(full.trim() && delta === full && chunks > 0, "Stream did not complete consistently");
checks.push({ check: "sdk-chat-stream-id-options", passed: true, chunks });
const cli = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));
const args = [cli, "--base-url", baseUrl, "--json"];
if (process.env.BKN_SKIP_VERSION_CHECK === "1") args.push("--skip-version-check");
if (process.env.BKN_INSECURE === "1") args.push("--insecure");
args.push(
  "model",
  "llm",
  "chat",
  id,
  "-m",
  messages[0].content,
  "--options",
  JSON.stringify(options),
);
const run = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 95_000 });
assert.ifError(run.error);
assert.equal(run.status, 0, "CLI chat failed; inspect locally without exposing credentials");
assert(JSON.parse(run.stdout).choices?.[0]?.message?.content?.trim());
checks.push({ check: "cli-chat-id-options", passed: true });
if (process.env.BKN_SMALL_MODEL_ID) {
  const small = await c.models.small.get(process.env.BKN_SMALL_MODEL_ID);
  let protectedFields = 0;
  const secret =
    /^(adapter[_-]?code|x[_-]?api[_-]?key|api[_-]?key|token|access[_-]?token|refresh[_-]?token|authorization|password|secret|secret[_-]?key|client[_-]?secret)$/i;
  const verify = (value) => {
    if (!value || typeof value !== "object") return;
    for (const [key, field] of Object.entries(value)) {
      if (secret.test(key)) {
        assert.equal(field, "<redacted>");
        protectedFields++;
      } else verify(field);
    }
  };
  verify(small);
  assert(protectedFields > 0, "No credential-shaped metadata was exercised");
  checks.push({ check: "small-model-get-protection", passed: true, protectedFields });
}
if (process.env.BKN_MODEL_TOOLS === "1") {
  const tool = {
    type: "function",
    function: {
      name: "sdk_probe",
      description: "A harmless schema probe; never executed",
      parameters: { type: "object", properties: {}, required: [] },
    },
  };
  const toolResult = await c.models.llm.chat(
    id,
    [{ role: "user", content: "Call sdk_probe once." }],
    {
      ...options,
      tools: [tool],
      toolChoice: "auto",
      maxTokens: 256,
    },
  );
  assert.equal(toolResult.choices?.[0]?.message?.tool_calls?.[0]?.function?.name, "sdk_probe");
  checks.push({ check: "sdk-tool-call-options", passed: true });
}
console.log(JSON.stringify({ baseUrl, modelId: id, modelName: name, checks }, null, 2));
