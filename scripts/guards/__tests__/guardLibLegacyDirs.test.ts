/**
 * SPEC-SYSTEM-DEBLOAT-1 Phase D — guard-lib-legacy-dirs fixture tests.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const GUARD = path.resolve(__dirname, "../guard-lib-legacy-dirs.mjs");
let root: string;

function write(rel: string, body: string) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf8");
}

function run(retiredLines: string[]) {
  const retiredList = path.join(root, "retired.txt");
  fs.writeFileSync(retiredList, retiredLines.join("\n") + "\n", "utf8");
  return spawnSync("node", [GUARD], {
    encoding: "utf8",
    env: {
      ...process.env,
      LIB_LEGACY_REPO_ROOT: root,
      LIB_LEGACY_SCAN_DIRS: "src",
      LIB_LEGACY_RETIRED_LIST: retiredList,
    },
  });
}

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "guard-lib-legacy-"));
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

describe("guard-lib-legacy-dirs", () => {
  it("passes when nothing imports a retired path", () => {
    write("src/a.ts", `import { writeAiEvent } from "@/lib/aiEvents";`);
    const r = run(["ai-events"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  it("fails on a static import from a retired path", () => {
    write("src/a.ts", `import { writeAiEvent } from "@/lib/ai-events";`);
    const r = run(["ai-events"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /@\/lib\/ai-events/);
  });

  it("fails on a dynamic import from a retired path", () => {
    write("src/a.ts", `const m = await import("@/lib/ai-events");`);
    const r = run(["ai-events"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /@\/lib\/ai-events/);
  });

  it("fails on an import from a subpath of a retired directory", () => {
    write("src/a.ts", `import { x } from "@/lib/checklist/helpers";`);
    const r = run(["checklist"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /@\/lib\/checklist/);
  });

  it("does not false-positive on a similarly-named non-retired module", () => {
    write("src/a.ts", `import { x } from "@/lib/ai-events-v2";`);
    const r = run(["ai-events"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  it("passes with zero retired paths configured", () => {
    write("src/a.ts", `import { writeAiEvent } from "@/lib/aiEvents";`);
    const r = run([]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  it("bare-path-only ($ suffix): fails on the exact bare import", () => {
    write("src/a.ts", `import { arbitrateClaims } from "@/lib/arbitration";`);
    const r = run(["arbitration$"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /@\/lib\/arbitration/);
  });

  it("bare-path-only ($ suffix): does NOT block the same-named surviving directory", () => {
    write("src/a.ts", `import { ingestClaimsForDeal } from "@/lib/arbitration/ingestClaims";`);
    const r = run(["arbitration$"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });
});
