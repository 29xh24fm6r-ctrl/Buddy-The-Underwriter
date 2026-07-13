/**
 * SPEC-CI-1 §5 — CI honesty smoke tests.
 *
 * (1) Guard-invocation completeness: every scripts/guards/*.mjs is reachable from
 *     `guard:all` (prevents orphan-drift — the bug this spec fixed).
 * (2) Glob-coverage minimum: the test:unit discovery yields at least a floor count
 *     (prevents someone silently re-narrowing the glob).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

const REPO = path.resolve(__dirname, "../..");
const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8"));
const scripts: Record<string, string> = pkg.scripts ?? {};

// Transitive closure of command text reachable from a root script, following
// `pnpm [-s] <name>` / `npm run <name>` references.
function reachableCommandText(root: string): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  const stack = [root];
  while (stack.length) {
    const name = stack.pop()!;
    if (seen.has(name)) continue;
    seen.add(name);
    const cmd = scripts[name];
    if (!cmd) continue;
    parts.push(cmd);
    const re = /(?:pnpm(?:\s+-s)?|npm\s+run)\s+([a-z0-9:_-]+)/gi;
    let m;
    while ((m = re.exec(cmd)) !== null) stack.push(m[1]);
  }
  return parts.join("\n");
}

describe("SPEC-CI-1 §5.1 — guard-invocation completeness", () => {
  // Guards intentionally NOT wired into guard:all (documented, remove-only).
  // Empty today: every scripts/guards/*.mjs is reachable from guard:all.
  const STANDALONE_ALLOW = new Set<string>([]);

  it("every scripts/guards/*.mjs is reachable from guard:all", () => {
    const guardsDir = path.join(REPO, "scripts/guards");
    const guardFiles = fs.readdirSync(guardsDir).filter((f) => f.endsWith(".mjs"));
    const reachable = reachableCommandText("guard:all");
    const orphans = guardFiles.filter(
      (f) => !STANDALONE_ALLOW.has(f) && !reachable.includes(f),
    );
    assert.deepEqual(
      orphans,
      [],
      `Guard(s) defined but not reachable from guard:all: ${orphans.join(", ")}. ` +
        `Wire into guard:all or add to STANDALONE_ALLOW with a reason.`,
    );
  });
});

describe("SPEC-CI-1 §5.2 — test:unit glob coverage floor", () => {
  it("discover-tests.mjs yields at least the coverage floor", () => {
    // Baseline broadened count at SPEC-CI-1 time ≈ 928 (excl invariants/quarantine).
    // Floor = ~90% catches accidental re-narrowing (old glob was 805).
    const MIN = 835;
    const out = execFileSync("node", ["scripts/discover-tests.mjs"], {
      cwd: REPO,
      encoding: "utf8",
    });
    const count = out.split("\n").filter(Boolean).length;
    assert.ok(
      count >= MIN,
      `test:unit discovery found ${count} files, below floor ${MIN} — did the glob get narrowed?`,
    );
  });

  // FIX (specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md P1): dynamic-segment
  // paths (`[dealId]`) are no longer excluded — they're glob-escaped so
  // `node --test` resolves them as literal directory names instead of
  // (mis)parsing `[dealId]` as a glob character class, which previously made
  // discover-tests.mjs exclude them AND made node --test silently report "0
  // tests" for them even when passed directly (verified: 9 real test files,
  // 54 tests, were dead this way — all pass once escaped). __invariants__ is
  // still excluded (owned by a different runner). Route-group parens
  // (`(app)`) were never actually a problem for node --test and are no
  // longer excluded either.
  it("discovery escapes bracket paths instead of excluding them, still excludes __invariants__", () => {
    const out = execFileSync("node", ["scripts/discover-tests.mjs"], {
      cwd: REPO,
      encoding: "utf8",
    });
    const lines = out.split("\n").filter(Boolean);

    const stillExcluded = lines.filter((l) => l.includes("__invariants__"));
    assert.deepEqual(stillExcluded, [], `discovery must still exclude __invariants__: ${stillExcluded.join(", ")}`);

    // Every discovered path must actually exist on disk once the glob-escaping
    // is reversed — proves the escaping is round-trippable, not corrupting paths.
    const unescape = (s: string) => s.replace(/\[\[\]/g, "[").replace(/\[\]\]/g, "]");
    const missing = lines.filter((l) => !fs.existsSync(path.join(REPO, unescape(l))));
    assert.deepEqual(missing, [], `discovered paths must exist on disk after unescaping: ${missing.join(", ")}`);

    // A known real dynamic-segment test file (research system audit finding
    // C1) must be present, and present in ESCAPED form — not silently
    // dropped, and not passed through unescaped (which node --test can't
    // resolve).
    const knownDynamicFile = lines.find((l) => l.includes("sourceArtifactViewer.test.ts"));
    assert.ok(knownDynamicFile, "sourceArtifactViewer.test.ts must be discovered, not excluded");
    assert.ok(
      knownDynamicFile!.includes("[[]dealId[]]") && knownDynamicFile!.includes("[[]action[]]"),
      `sourceArtifactViewer.test.ts path must be glob-escaped, got: ${knownDynamicFile}`,
    );
  });
});
