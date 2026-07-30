/**
 * SPEC-DRIFT-HARDENING-1 D4 — aegis screen-recording RETIRE regression.
 *
 * §0 V0.3 confirmed zero inbound references to /api/aegis/recording/start
 * or /stop beyond the routes' own files (the separate /api/aegis/findings +
 * findings/resolve pair is an unrelated feature, untouched here). Matt
 * confirmed RETIRE. This guards against either route file being
 * accidentally reintroduced, and confirms deleting them left no dangling
 * link/import for guard-internal-links to catch.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const REPO_ROOT = join(__dirname, "../../..");

describe("aegis recording retirement (D4)", () => {
  it("the recording/start and recording/stop route files are gone", () => {
    assert.equal(
      existsSync(join(REPO_ROOT, "src/app/api/aegis/recording/start/route.ts")),
      false,
    );
    assert.equal(
      existsSync(join(REPO_ROOT, "src/app/api/aegis/recording/stop/route.ts")),
      false,
    );
  });

  it("the unrelated findings + findings/resolve routes are untouched", () => {
    assert.equal(
      existsSync(join(REPO_ROOT, "src/app/api/aegis/findings/route.ts")),
      true,
    );
    assert.equal(
      existsSync(join(REPO_ROOT, "src/app/api/aegis/findings/resolve/route.ts")),
      true,
    );
  });

  it("guard-internal-links passes against the real repo with the routes gone", () => {
    const r = spawnSync("node", [join(REPO_ROOT, "scripts/guards/guard-internal-links.mjs")], {
      encoding: "utf8",
      cwd: REPO_ROOT,
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  it("guard-dropped-tables passes against the real repo (no cast-evasion reference remains)", () => {
    const r = spawnSync("node", [join(REPO_ROOT, "scripts/guards/guard-dropped-tables.mjs")], {
      encoding: "utf8",
      cwd: REPO_ROOT,
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });
});
