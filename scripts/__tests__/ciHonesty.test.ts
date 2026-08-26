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

  // Dynamic-segment paths (`[dealId]`, `[token]`) are emitted as `?`
  // wildcards so `node --test` resolves them, and run through
  // scripts/run-unit-tests.mjs so no shell expands the wildcards first.
  //
  // The previous version of this guard checked that the printed paths were
  // glob-escaped and round-trippable. Both were true, and both were beside
  // the point: package.json fed the output through an unquoted `$(...)`, the
  // shell expanded the escaping back to a literal `[dealId]`, and node
  // globbed that to nothing. Seventeen files reported "0 tests" while this
  // guard counted them as discovered (audit F-24).
  //
  // So the assertion below is EXECUTION, not spelling: a known
  // dynamic-segment test file must actually run tests.
  it("discovery still excludes __invariants__ and emits resolvable paths", () => {
    const out = execFileSync("node", ["scripts/discover-tests.mjs"], {
      cwd: REPO,
      encoding: "utf8",
    });
    const lines = out.split("\n").filter(Boolean);

    const stillExcluded = lines.filter((l) => l.includes("__invariants__"));
    assert.deepEqual(stillExcluded, [], `discovery must still exclude __invariants__: ${stillExcluded.join(", ")}`);

    // Every emitted pattern must select exactly one real file. `?` matches any
    // single character, so an over-broad pattern could silently pull in a
    // different file — or none, which is the bug this whole area is about.
    const realPaths = execFileSync("node", ["scripts/discover-tests.mjs", "--paths"], {
      cwd: REPO,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
    assert.equal(lines.length, realPaths.length, "pattern list and path list must correspond 1:1");

    const ambiguous: string[] = [];
    lines.forEach((pattern, i) => {
      const re = new RegExp(
        "^" +
          pattern
            .split("?")
            .map((part) => part.replace(/[.*+^${}()|[\]\\]/g, "\\$&"))
            .join(".") +
          "$",
      );
      const matches = realPaths.filter((real) => re.test(real));
      if (matches.length !== 1 || matches[0] !== realPaths[i]) {
        ambiguous.push(`${pattern} -> ${matches.length} match(es)`);
      }
      if (!fs.existsSync(path.join(REPO, realPaths[i]))) {
        ambiguous.push(`${realPaths[i]} (missing on disk)`);
      }
    });
    assert.deepEqual(ambiguous, [], `every pattern must resolve to exactly one file: ${ambiguous.join(", ")}`);

    const knownDynamicFile = lines.find((l) => l.includes("sourceArtifactViewer.test.ts"));
    assert.ok(knownDynamicFile, "sourceArtifactViewer.test.ts must be discovered, not excluded");
    assert.ok(
      knownDynamicFile!.includes("?dealId?") && knownDynamicFile!.includes("?action?"),
      `dynamic segments must be emitted as resolvable wildcards, got: ${knownDynamicFile}`,
    );
  });

  it("[F-24] a dynamic-segment test file actually RUNS, not just discovers", () => {
    // The property the old guard could not see. If this file reports 0 tests
    // it is dead in CI no matter how correct its path looks in the listing.
    const target = "src/app/api/borrower/portal/?token?/__tests__/assumptionConfirmDeadendFix.test.ts";
    // NODE_TEST_CONTEXT is set in this process because THIS file is running
    // under node --test. Inheriting it makes the child emit worker-protocol
    // output instead of TAP, so the "# tests" line never appears and the
    // check would read 0 for a perfectly healthy file. Strip it.
    const { NODE_TEST_CONTEXT: _drop, NODE_OPTIONS: _dropOpts, ...cleanEnv } = process.env;
    let stdout: string;
    try {
      stdout = execFileSync(
        process.execPath,
        ["--test", "--import", "tsx", target],
        { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: cleanEnv },
      );
    } catch (err: any) {
      stdout = String(err.stdout ?? "");
    }
    const reported = Number((stdout.match(/^# tests (\d+)/m) ?? [])[1] ?? 0);
    assert.ok(
      reported > 0,
      `dynamic-segment test file reported ${reported} tests — it is not executing in CI`,
    );
  });

  it("[F-24] the unit runner never hands test paths to a shell", () => {
    // shell:true would re-expand the `?` wildcards and silently resurrect the
    // bug. The runner exists only to prevent that.
    const runner = fs.readFileSync(path.join(REPO, "scripts/run-unit-tests.mjs"), "utf8");
    assert.match(runner, /shell:\s*false/, "run-unit-tests must spawn with shell:false");

    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8"));
    for (const script of ["test:unit", "test:unit:react-server"]) {
      assert.match(
        pkg.scripts[script],
        /run-unit-tests\.mjs/,
        `${script} must go through the shell-free runner`,
      );
      assert.doesNotMatch(
        pkg.scripts[script],
        /\$\(/,
        `${script} must not use command substitution — the shell expands the patterns`,
      );
    }
  });
});
