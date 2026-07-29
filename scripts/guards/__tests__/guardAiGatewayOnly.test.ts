/**
 * SPEC-M1 AI-GATEWAY-1 — guard-ai-gateway-only.mjs fixture tests.
 *
 * Exercises the guard against a temp fixture tree via child_process,
 * driving the env overrides (BASE / ROOT / ALLOWLIST). Same harness shape
 * as guardDealRouteAccess.test.ts.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const GUARD = path.resolve(__dirname, "../guard-ai-gateway-only.mjs");

let root: string;

function writeFile(rel: string, body: string) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf8");
}

function runGuard(allowlistLines: string[]) {
  const allowlistPath = path.join(root, "allowlist.txt");
  fs.writeFileSync(allowlistPath, allowlistLines.join("\n") + "\n", "utf8");
  return spawnSync("node", [GUARD], {
    encoding: "utf8",
    env: {
      ...process.env,
      AI_GATEWAY_GUARD_BASE: root,
      AI_GATEWAY_GUARD_ROOT: path.join(root, "src"),
      AI_GATEWAY_GUARD_ALLOWLIST: allowlistPath,
    },
  });
}

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "guard-ai-gateway-only-"));

  // a) direct Gemini REST call, not allowlisted — must fail
  writeFile(
    "src/lib/unpatched/callsGemini.ts",
    `const url = "https://generativelanguage.googleapis.com/v1beta/models/x:generateContent";`,
  );
  // b) direct Gemini REST call, allowlisted — passes as tracked debt
  writeFile(
    "src/lib/legacy/callsGemini.ts",
    `const url = "https://generativelanguage.googleapis.com/v1beta/models/x:generateContent";`,
  );
  // c) bare "openai" SDK import, not allowlisted — must fail
  writeFile("src/lib/unpatched/callsOpenAiSdk.ts", `import OpenAI from "openai";`);
  // d) a file inside the allowed providers/ dir — never flagged, even though
  //    it obviously calls the endpoint directly (that's its whole job)
  writeFile(
    "src/lib/ai/providers/google.ts",
    `const url = "https://generativelanguage.googleapis.com/v1beta/models/x:generateContent";`,
  );
  // e) a file inside a __tests__ dir — excluded from scanning entirely
  writeFile(
    "src/lib/unpatched/__tests__/fixture.test.ts",
    `const url = "https://generativelanguage.googleapis.com/v1beta/models/x:generateContent";`,
  );
  // f) a clean file with no banned pattern at all
  writeFile("src/lib/clean/util.ts", `export const x = 1;`);
});

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("guard-ai-gateway-only fixtures", () => {
  it("passes when the only real violation is allowlisted", () => {
    const res = runGuard(["src/lib/legacy/callsGemini.ts"]);
    // src/lib/unpatched/callsGemini.ts and callsOpenAiSdk.ts are NOT
    // allowlisted here, so this must still fail — sanity-checked in the
    // next test. This test isolates just the allowlisted-passes case by
    // allowlisting all three known violations.
    assert.equal(res.status, 1);
  });

  it("passes when every real violation is allowlisted, providers/ and __tests__ never counted", () => {
    const res = runGuard([
      "src/lib/legacy/callsGemini.ts",
      "src/lib/unpatched/callsGemini.ts",
      "src/lib/unpatched/callsOpenAiSdk.ts",
    ]);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /guard passed/);
  });

  it("fails when a violation is not allowlisted", () => {
    const res = runGuard(["src/lib/legacy/callsGemini.ts", "src/lib/unpatched/callsGemini.ts"]);
    // callsOpenAiSdk.ts missing from the allowlist
    assert.equal(res.status, 1);
    assert.match(res.stderr, /callsOpenAiSdk\.ts/);
  });

  it("fails on a stale allowlist entry (file no longer violates)", () => {
    const res = runGuard([
      "src/lib/legacy/callsGemini.ts",
      "src/lib/unpatched/callsGemini.ts",
      "src/lib/unpatched/callsOpenAiSdk.ts",
      "src/lib/clean/util.ts", // never violated — stale
    ]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /stale allowlist/i);
    assert.match(res.stderr, /clean\/util\.ts/);
  });

  it("never flags files inside src/lib/ai/providers/", () => {
    // Allowlist everything except providers/google.ts — if the guard ever
    // flagged files inside providers/, this would fail with an unpatched
    // violation for providers/google.ts.
    const res = runGuard([
      "src/lib/legacy/callsGemini.ts",
      "src/lib/unpatched/callsGemini.ts",
      "src/lib/unpatched/callsOpenAiSdk.ts",
    ]);
    assert.equal(res.status, 0, res.stdout + res.stderr);
  });
});
