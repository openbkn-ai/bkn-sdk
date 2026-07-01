// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the OpenBKN License. See the LICENSE file in the project root.

/**
 * LLM judge backed by the local `claude` CLI run as a one-shot subprocess:
 *   claude -p --output-format=json --dangerously-skip-permissions  (prompt on stdin)
 * The CLI returns a stable envelope `{ result: "<text>" }`; the model is asked
 * to make that text strict JSON, which we then parse. No HTTP/SDK key needed —
 * it reuses the user's existing Claude Code auth. Used by the trace diagnose
 * rubric pillar (the second, semantic half of `diagnose`).
 */
import { spawn, spawnSync } from "node:child_process";

export class ClaudeJudgeError extends Error {
  constructor(
    message: string,
    readonly reason: "not_available" | "timeout" | "bad_output" | "exit",
  ) {
    super(message);
    this.name = "ClaudeJudgeError";
  }
}

/** True when a `claude` binary is on PATH and responds to --version. */
export function claudeAvailable(binary = "claude"): boolean {
  try {
    const r = spawnSync(binary, ["--version"], {
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return r.status === 0;
  } catch {
    return false;
  }
}

function extractEnvelope(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) throw new ClaudeJudgeError("claude returned empty stdout", "bad_output");
  const env = JSON.parse(trimmed) as { result?: unknown; text?: unknown };
  const text = typeof env.result === "string" ? env.result : env.text;
  if (typeof text !== "string")
    throw new ClaudeJudgeError("claude envelope had no result text", "bad_output");
  return text;
}

/** Pull the first balanced JSON object out of a (possibly fenced) string. */
function extractJsonObject(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced?.[1] ?? text;
  const start = body.indexOf("{");
  if (start === -1) throw new ClaudeJudgeError("no JSON object in judge output", "bad_output");
  let depth = 0;
  for (let i = start; i < body.length; i++) {
    if (body[i] === "{") depth++;
    else if (body[i] === "}" && --depth === 0) return body.slice(start, i + 1);
  }
  throw new ClaudeJudgeError("unbalanced JSON object in judge output", "bad_output");
}

/** Run the prompt through `claude` and parse the reply as a JSON object. */
export async function judgeJson(
  prompt: string,
  opts: { binary?: string; timeoutMs?: number } = {},
): Promise<Record<string, unknown>> {
  const binary = opts.binary ?? "claude";
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const args = ["-p", "--output-format=json", "--dangerously-skip-permissions"];

  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let timedOut = false;
    const killer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2000).unref();
    }, timeoutMs);
    killer.unref();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d: string) => {
      out += d;
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(killer);
      reject(
        err.code === "ENOENT"
          ? new ClaudeJudgeError("`claude` not found on PATH", "not_available")
          : err,
      );
    });
    child.on("close", (code) => {
      clearTimeout(killer);
      if (timedOut)
        return reject(new ClaudeJudgeError(`claude timed out after ${timeoutMs}ms`, "timeout"));
      if (code !== 0) return reject(new ClaudeJudgeError(`claude exited ${code}`, "exit"));
      resolve(out);
    });
    child.stdin.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code !== "EPIPE") reject(err);
    });
    child.stdin.end(prompt);
  });

  const text = extractEnvelope(stdout);
  return JSON.parse(extractJsonObject(text)) as Record<string, unknown>;
}
