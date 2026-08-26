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

  // Dynamic-segment paths (`[dealId]`, `[token]`) are the long-standing
  // hazard here. `node --test <arg>` means different things on the Node CI
  // runs (20) and the Node the package declares (22):
  //
  //   [dealId] literal  -> Node 20 runs it;      Node 22 globs it to nothing
  //   ?dealId? wildcard -> Node 20 cannot find it; Node 22 runs it
  //
  // No string form works on both, and the Node 22 direction fails SILENTLY
  // ("0 tests, 0 fail"), which reads as green. The runner therefore uses
  // node:test's run({ files }) API, which applies no glob semantics anywhere.
  //
  // The previous guard here checked that discovery emitted glob-escaped
  // strings and that they round-tripped. Both were true while a developer on
  // Node 22 was silently losing 17 files. So these assertions check EFFECTS:
  // the paths exist, and a dynamic-segment file actually reports tests.
  it("discovery still excludes __invariants__ and emits real, existing paths", () => {
    const out = execFileSync("node", ["scripts/discover-tests.mjs"], {
      cwd: REPO,
      encoding: "utf8",
    });
    const lines = out.split("\n").filter(Boolean);

    const stillExcluded = lines.filter((l) => l.includes("__invariants__"));
    assert.deepEqual(stillExcluded, [], `discovery must still exclude __invariants__: ${stillExcluded.join(", ")}`);

    const missing = lines.filter((l) => !fs.existsSync(path.join(REPO, l)));
    assert.deepEqual(missing, [], `every discovered path must exist on disk: ${missing.slice(0, 5).join(", ")}`);

    // No escaping or wildcard forms may creep back in — they are the shapes
    // whose behaviour differs between Node versions.
    const patterned = lines.filter((l) => l.includes("?") || l.includes("[[]") || l.includes("[]]"));
    assert.deepEqual(patterned, [], `discovery must emit literal paths, not glob patterns: ${patterned.slice(0, 3).join(", ")}`);

    const knownDynamicFile = lines.find((l) => l.includes("sourceArtifactViewer.test.ts"));
    assert.ok(knownDynamicFile, "sourceArtifactViewer.test.ts must be discovered, not excluded");
    assert.ok(
      knownDynamicFile!.includes("[dealId]") && knownDynamicFile!.includes("[action]"),
      `dynamic segments must be emitted literally, got: ${knownDynamicFile}`,
    );
  });

  it("[F-24] dynamic-segment test files actually RUN under this Node", () => {
    // The property no path-shape assertion can see. If these report 0 tests
    // they are dead on whichever Node is executing, however correct the
    // listing looks.
    const { NODE_TEST_CONTEXT: _c, NODE_OPTIONS: _o, ...cleanEnv } = process.env;
    let stdout: string;
    try {
      stdout = execFileSync(
        process.execPath,
        ["--import", "tsx", "scripts/run-unit-tests.mjs", "--files-probe"],
        { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: cleanEnv },
      );
    } catch (err: any) {
      stdout = String(err.stdout ?? "");
    }
    const reported = Number((stdout.match(/^# tests (\d+)/m) ?? [])[1] ?? 0);
    assert.ok(
      reported > 0,
      `the dynamic-segment probe reported ${reported} tests — those files are not executing on Node ${process.version}`,
    );
  });

  it("[F-24] the runner uses run({ files }), not positional node --test paths", () => {
    // Passing paths positionally is the shape whose meaning differs between
    // Node 20 and Node 22. Both the runner and package.json must stay off it.
    const runner = fs.readFileSync(path.join(REPO, "scripts/run-unit-tests.mjs"), "utf8");
    assert.match(runner, /from "node:test"/, "runner must use the node:test run API");
    assert.match(runner, /run\(\s*\{\s*files/, "runner must pass an explicit files array");

    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8"));
    for (const script of ["test:unit", "test:unit:react-server"]) {
      assert.match(
        pkg.scripts[script],
        /run-unit-tests\.mjs/,
        `${script} must go through the run() runner`,
      );
      assert.doesNotMatch(
        pkg.scripts[script],
        /--test\b/,
        `${script} must not use positional node --test paths`,
      );
      assert.doesNotMatch(
        pkg.scripts[script],
        /\$\(/,
        `${script} must not use command substitution`,
      );
    }
  });
});
