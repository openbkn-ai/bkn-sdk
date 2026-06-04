import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
/**
 * Full-depth CLI help-equivalence test.
 *
 * Equivalence is recursive: every legacy command, subcommand, AND
 * sub-subcommand must exist in `openbkn` with equivalent help. Sources of the
 * legacy command tree:
 *   - kweaver:        baselines/kweaver/_help-all.txt  (full-depth signature manifest)
 *   - kweaver-admin:  baselines/kweaver-admin/sub/<cmd>__<sub>.help.txt (depth-2)
 *                     + depth-1 group help files
 *
 * For each legacy path we (a) assert the mapped `openbkn <path> --help` exists
 * (tree-shape parity at every depth) and (b) where a per-node baseline file
 * exists, assert the new help covers the legacy capability tokens (subset).
 *
 * Until the `openbkn` binary builds (Phase 2) the live cases SKIP; the manifest /
 * fixture cases still run so the tree stays documented and green.
 *
 * Run: `npm test`. Regenerate baselines: ./capture-baselines.sh
 */
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const baselines = join(here, "baselines");
const BKN_BIN = process.env.BKN_BIN ?? join(here, "..", "..", "dist", "cli.js");
// Live parity is opt-in: the command tree is registered incrementally, so we
// only assert full parity once it is complete. Flip on with BKN_EQUIV_LIVE=1
// (requires a built `dist/cli.js` or BKN_BIN). Until then the manifest tests
// below still run and keep the legacy tree documented.
const bknReady = existsSync(BKN_BIN) && process.env.BKN_EQUIV_LIVE === "1";

/**
 * kweaver (sdk) top-level → openbkn top-level. The binary is `openbkn`;
 * subcommand names are kept identical, so the knowledge-network command stays
 * `bkn` (no rename). Only genuine folds appear here.
 * kweaver-admin maps separately: `kweaver-admin <x>` → `openbkn admin <x>`.
 */
const TOP_RENAME: Record<string, string> = {
  "context-loader": "context",
};
/** Multi-segment rewrites applied to a kweaver path. */
const PATH_REWRITE: Record<string, string[]> = {
  token: ["auth", "token"], // standalone `token` folded under `auth`
};

/** Legacy paths intentionally dropped (see command-map.md). */
const DROPPED = new Set<string>([
  "bkn build", // KN-level build removed; index build → `vega dataset build`
  "bkn create-from-ds",
  "context-loader kn-search",
  "context-loader kn-schema-search",
  "context-loader config",
]);

function mapPath(legacy: string[]): string[] {
  const head = legacy[0];
  if (!head) return legacy;
  const rest = legacy.slice(1);
  const rewrite = PATH_REWRITE[head];
  if (rewrite) return [...rewrite, ...rest]; // token / llm / small-model
  return [TOP_RENAME[head] ?? head, ...rest];
}

function normalize(text: string): string {
  return (
    text
      // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escape sequences needs ESC
      .replace(/\[[0-9;]*m/g, "")
      .replace(/\bkweaver-admin\b/g, "<cli>")
      .replace(/\bkweaver\b/g, "<cli>")
      .replace(/\bbkn\b/g, "<cli>")
      .toLowerCase()
  );
}

/**
 * Capability tokens for equivalence: the `--flags` a command accepts plus the
 * positional argument names from its `Usage:` line (`<arg>` / `[arg]`). Both
 * legacy and `openbkn` are commander, so this is symmetric and free of the
 * wrapped-description prose noise a "first indented word" heuristic picks up.
 */
function capabilityTokens(text: string): Set<string> {
  const out = new Set<string>();
  const n = normalize(text);
  for (const m of n.matchAll(/--[a-z][a-z0-9-]+/g)) out.add(m[0]);
  // Find the usage line in both formats: legacy commander (`usage: <cli> …`) and
  // openbkn's grouped help (`usage` header on its own line, invocation next).
  const lines = n.split("\n");
  let usage = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (/usage:/i.test(line)) {
      usage = line;
      break;
    }
    if (/^\s*usage\s*$/i.test(line)) {
      usage = lines[i + 1] ?? "";
      break;
    }
  }
  // `<cli>` is normalize()'s placeholder for the binary name — not a real arg.
  const skip = new Set(["options", "command", "cli"]);
  for (const m of usage.matchAll(/[<[]([a-z][a-z0-9-]*)(?:\.\.\.)?[>\]]/g)) {
    if (m[1] && !skip.has(m[1])) out.add(m[1]);
  }
  return out;
}

/** Parse the kweaver `help all` manifest into a list of command paths. */
function parseKweaverPaths(): string[][] {
  const text = readFileSync(join(baselines, "kweaver", "_help-all.txt"), "utf8");
  const paths: string[][] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/^\s*\[deprecated\]\s*/, "").trim();
    const m = line.match(/^kweaver\s+(.*)$/);
    if (!m?.[1]) continue;
    const tokens = m[1].split(/\s+/);
    const path: string[] = [];
    let pipedLeaves: string[] | null = null;
    for (const t of tokens) {
      if (/^[a-z][a-z0-9-]*$/.test(t)) {
        path.push(t);
      } else if (/^[a-z][a-z0-9-]*(\|[a-z][a-z0-9-]*)+$/.test(t)) {
        pipedLeaves = t.split("|"); // e.g. list|get|create
        break;
      } else {
        break; // <arg>, [opt], --flag, (alias…)
      }
    }
    if (path.length === 0) continue;
    if (pipedLeaves) {
      for (const leaf of pipedLeaves) paths.push([...path, leaf]);
    } else {
      paths.push(path);
    }
  }
  return paths;
}

/** Parse kweaver-admin depth-2 paths from sub/ fixture filenames. */
function parseAdminPaths(): string[][] {
  const subDir = join(baselines, "kweaver-admin", "sub");
  if (!existsSync(subDir)) return [];
  return readdirSync(subDir)
    .filter((f) => f.endsWith(".help.txt"))
    .map((f) => f.replace(/\.help\.txt$/, "").split("__"));
}

function adminBaselineFor(path: string[]): string | null {
  const file = join(baselines, "kweaver-admin", "sub", `${path.join("__")}.help.txt`);
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

function runBknHelp(argv: string[]): { ok: boolean; out: string } {
  try {
    const isJs = BKN_BIN.endsWith(".js");
    const bin = isJs ? process.execPath : BKN_BIN;
    const args = isJs ? [BKN_BIN, ...argv, "--help"] : [...argv, "--help"];
    const out = execFileSync(bin, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, out };
  } catch (e: unknown) {
    const err = e as { stdout?: unknown; stderr?: unknown };
    return { ok: false, out: String(err.stdout ?? "") + String(err.stderr ?? "") };
  }
}

function uniq(paths: string[][]): string[][] {
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const p of paths) {
    const k = p.join(" ");
    if (!seen.has(k)) {
      seen.add(k);
      out.push(p);
    }
  }
  return out;
}

// ---- Build the full legacy command tree ------------------------------------
const kweaverPaths = uniq(parseKweaverPaths()).filter((p) => !DROPPED.has(p.join(" ")));
const adminPaths = uniq(parseAdminPaths()).filter((p) => !DROPPED.has(p.join(" ")));

// ---- Live equivalence (runs once `openbkn` builds) -----------------------------
describe.skipIf(!bknReady)("full-depth tree parity: kweaver → bkn", () => {
  for (const legacy of kweaverPaths) {
    const mapped = mapPath(legacy);
    it(`openbkn ${mapped.join(" ")} --help exists (⇐ kweaver ${legacy.join(" ")})`, () => {
      expect(runBknHelp(mapped).ok, `openbkn ${mapped.join(" ")} --help failed`).toBe(true);
    });
  }
});

describe.skipIf(!bknReady)("full-depth tree parity: kweaver-admin → openbkn admin", () => {
  for (const legacy of adminPaths) {
    // kweaver-admin is nested 1:1 under `openbkn admin`.
    const mapped = ["admin", ...legacy];
    it(`openbkn ${mapped.join(" ")} --help covers kweaver-admin ${legacy.join(" ")}`, () => {
      const res = runBknHelp(mapped);
      expect(res.ok, `openbkn ${mapped.join(" ")} --help failed`).toBe(true);
      const base = adminBaselineFor(legacy);
      if (base) {
        const missing = [...capabilityTokens(base)].filter(
          (t) => !capabilityTokens(res.out).has(t),
        );
        expect(missing, "missing legacy capabilities").toEqual([]);
      }
    });
  }
});

// ---- Manifest sanity (runs now, even without the binary) -------------------
describe("legacy command-tree manifest", () => {
  it("parsed a non-trivial kweaver tree from help all", () => {
    expect(kweaverPaths.length).toBeGreaterThan(40);
  });
  it("parsed kweaver-admin depth-2 paths", () => {
    expect(adminPaths.length).toBeGreaterThan(30);
  });
  it("deep paths are present (e.g. bkn object-type list → openbkn bkn object-type list)", () => {
    const hasDeep = kweaverPaths.some(
      (p) => p.length >= 3 && p[0] === "bkn" && p[1] === "object-type",
    );
    expect(hasDeep).toBe(true);
  });
});
