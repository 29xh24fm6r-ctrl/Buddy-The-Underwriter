/**
 * SPEC-M1 AI-GATEWAY-1, Program Invariant #2 —
 * guard-ai-disclaimer.mjs fixture tests.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const GUARD = path.resolve(__dirname, "../guard-ai-disclaimer.mjs");

let root: string;

function writeFile(rel: string, body: string) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf8");
}

function runGuard() {
  return spawnSync("node", [GUARD], {
    encoding: "utf8",
    env: {
      ...process.env,
      AI_DISCLAIMER_GUARD_BASE: root,
      AI_DISCLAIMER_GUARD_ROOT: path.join(root, "src"),
    },
  });
}

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "guard-ai-disclaimer-"));
});

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("guard-ai-disclaimer fixtures", () => {
  it("passes a repo with no marked surfaces at all", () => {
    fs.rmSync(path.join(root, "src"), { recursive: true, force: true });
    writeFile("src/lib/util.ts", `export const x = 1;`);
    const res = runGuard();
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /0 marked/);
  });

  it("passes a marked surface that imports disclaimers.ts", () => {
    fs.rmSync(path.join(root, "src"), { recursive: true, force: true });
    writeFile(
      "src/components/Readiness.tsx",
      `// ai-disclaimer-surface: readiness\nimport { getDisclaimer } from "@/lib/ai/disclaimers";\nexport const X = getDisclaimer("readiness");`,
    );
    const res = runGuard();
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /1 marked/);
  });

  it("fails a marked surface that does NOT import disclaimers.ts", () => {
    fs.rmSync(path.join(root, "src"), { recursive: true, force: true });
    writeFile(
      "src/components/Readiness.tsx",
      `// ai-disclaimer-surface: readiness\nexport const X = "not a decision, trust me";`,
    );
    const res = runGuard();
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Readiness\.tsx/);
  });

  it("recognizes all four surface types", () => {
    fs.rmSync(path.join(root, "src"), { recursive: true, force: true });
    for (const surface of ["readiness", "memo", "fix_card", "interview"]) {
      writeFile(
        `src/components/${surface}.tsx`,
        `// ai-disclaimer-surface: ${surface}\nimport { getDisclaimer } from "@/lib/ai/disclaimers";`,
      );
    }
    const res = runGuard();
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /4 marked/);
  });

  it("ignores files inside __tests__ dirs", () => {
    fs.rmSync(path.join(root, "src"), { recursive: true, force: true });
    writeFile(
      "src/components/__tests__/fixture.test.ts",
      `// ai-disclaimer-surface: memo\nexport const X = "no import here";`,
    );
    const res = runGuard();
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /0 marked/);
  });
});
