import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { matchDecisionPath } from "@/app/api/deals/[dealId]/decision/_handlers/dispatchTable";

/**
 * Decision route-family consolidation — the catch-all dispatcher must preserve every public
 * endpoint, param shape, HTTP method, and non-JSON (PDF/ZIP) response of the former child routes.
 * Tests the pure routing table + source-level guarantees of the dispatcher (the handler modules
 * are server-only and cannot be imported under the node test runner).
 *
 * NOTE: this test lives under src/lib/decision/__tests__ (not co-located beside the route) because
 * the node --test harness silently skips files under bracketed `[dealId]` paths.
 */

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../..");
const DECISION = "src/app/api/deals/[dealId]/decision";
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

describe("matchDecisionPath — path → handler mapping", () => {
  it("static top-level routes take precedence over [snapshotId]", () => {
    assert.equal(matchDecisionPath(["generate"])?.route.handler, "generate");
    assert.equal(matchDecisionPath(["latest"])?.route.handler, "latest");
    assert.equal(matchDecisionPath(["audit-export"])?.route.handler, "audit-export");
  });

  it("[snapshotId] dispatches and carries the snapshot id", () => {
    const m = matchDecisionPath(["snap-123"]);
    assert.equal(m?.route.handler, "snapshot");
    assert.equal(m?.params.snapshotId, "snap-123");
  });

  it("all [snapshotId] children dispatch with the snapshot id", () => {
    const cases = ["attest", "committee-status", "counterfactual", "diff", "finalize", "pdf", "regulator-zip"];
    for (const seg of cases) {
      const m = matchDecisionPath(["s1", seg]);
      assert.equal(m?.route.handler, seg, seg);
      assert.equal(m?.params.snapshotId, "s1", seg);
    }
  });

  it("committee sub-routes dispatch (vote among them)", () => {
    assert.equal(matchDecisionPath(["s1", "committee", "dissent"])?.route.handler, "committee/dissent");
    assert.equal(matchDecisionPath(["s1", "committee", "minutes"])?.route.handler, "committee/minutes");
    assert.equal(matchDecisionPath(["s1", "committee", "status"])?.route.handler, "committee/status");
    const vote = matchDecisionPath(["s1", "committee", "vote"]);
    assert.equal(vote?.route.handler, "committee/vote");
    assert.equal(vote?.params.snapshotId, "s1");
  });

  it("distinguishes committee-status (top) from committee/status (nested)", () => {
    assert.equal(matchDecisionPath(["s1", "committee-status"])?.route.handler, "committee-status");
    assert.equal(matchDecisionPath(["s1", "committee", "status"])?.route.handler, "committee/status");
  });

  it("unknown paths return null (→ 404)", () => {
    assert.equal(matchDecisionPath([]), null);
    assert.equal(matchDecisionPath(["s1", "bogus"]), null);
    assert.equal(matchDecisionPath(["s1", "committee", "bogus"]), null);
    assert.equal(matchDecisionPath(["s1", "not-committee", "vote"]), null);
    assert.equal(matchDecisionPath(["a", "b", "c", "d"]), null);
  });
});

describe("method support drives 405", () => {
  it("GET-only routes don't allow POST", () => {
    for (const p of [["latest"], ["s1", "diff"], ["s1", "pdf"], ["s1", "regulator-zip"], ["s1", "committee", "status"]]) {
      assert.deepEqual(matchDecisionPath(p)?.route.methods, ["GET"], p.join("/"));
    }
  });
  it("POST-only routes don't allow GET", () => {
    for (const p of [["generate"], ["s1", "finalize"], ["s1", "committee", "vote"]]) {
      assert.deepEqual(matchDecisionPath(p)?.route.methods, ["POST"], p.join("/"));
    }
  });
  it("dual-method routes allow both", () => {
    assert.deepEqual(matchDecisionPath(["s1"])?.route.methods.slice().sort(), ["GET", "POST"]);
    assert.deepEqual(matchDecisionPath(["s1", "attest"])?.route.methods.slice().sort(), ["GET", "POST"]);
  });
});

describe("dispatcher source guarantees", () => {
  const dispatcher = read(`${DECISION}/[...path]/route.ts`);

  it("404s unknown paths and 405s unsupported methods", () => {
    assert.match(dispatcher, /status:\s*404/);
    assert.match(dispatcher, /status:\s*405/);
    assert.match(dispatcher, /methods\.includes\(method\)/);
  });

  it("returns the handler Response untouched (preserves PDF/ZIP/non-JSON bodies)", () => {
    assert.match(dispatcher, /return fn\(req, \{ params \}\)/);
  });

  it("carries the superset route-segment config (Spec D5 headroom preserved)", () => {
    assert.match(dispatcher, /runtime = "nodejs"/);
    assert.match(dispatcher, /dynamic = "force-dynamic"/);
    assert.match(dispatcher, /maxDuration = 60/);
  });

  it("every routing-table handler key has a backing module", () => {
    for (const key of [
      "generate", "latest", "audit-export", "snapshot", "attest", "committee-status",
      "counterfactual", "diff", "finalize", "pdf", "regulator-zip",
      "committee/dissent", "committee/minutes", "committee/status", "committee/vote",
    ]) {
      assert.match(dispatcher, new RegExp(`"${key.replace(/\//g, "\\/")}":`), `module for ${key}`);
    }
  });
});

describe("filesystem consolidation", () => {
  it("base /decision route preserved; catch-all added; child route.ts files removed", () => {
    assert.ok(fs.existsSync(path.join(repoRoot, `${DECISION}/route.ts`)), "base route preserved");
    assert.ok(fs.existsSync(path.join(repoRoot, `${DECISION}/[...path]/route.ts`)), "dispatcher added");
    for (const gone of ["generate", "latest", "audit-export", "[snapshotId]"]) {
      assert.ok(!fs.existsSync(path.join(repoRoot, `${DECISION}/${gone}/route.ts`)), `${gone}/route.ts removed`);
    }
  });
});
