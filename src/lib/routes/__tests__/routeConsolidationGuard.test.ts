/**
 * SPEC-ROUTE-CONSOLIDATION-1 — Route consolidation invariant guards
 *
 * Proves:
 *   1. Consolidated route groups expose the same public URL patterns
 *   2. _handlers files are not counted as route files
 *   3. No duplicate route segment accidentally reappears
 *   4. Route count stays below warning threshold (1900)
 *   5. Route count stays below hard threshold (2048)
 *   6. Consolidated groups retain their catch-all route files
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../../../..");

function countRouteFiles(): number {
  const out = execSync("find src/app/api -name route.ts | wc -l", {
    cwd: ROOT,
    encoding: "utf-8",
  });
  return parseInt(out.trim(), 10);
}

function countPageFiles(): number {
  const out = execSync("find src/app -name page.tsx | wc -l", {
    cwd: ROOT,
    encoding: "utf-8",
  });
  return parseInt(out.trim(), 10);
}

function findFiles(pattern: string): string[] {
  try {
    const out = execSync(`find ${pattern}`, {
      cwd: ROOT,
      encoding: "utf-8",
    });
    return out.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

describe("route consolidation invariants", () => {
  // ── 1. Consolidated groups expose same URL patterns ─────────────────

  it("ops catch-all dispatcher handles all original ops sub-routes", () => {
    const dispatcher = readFileSync(
      resolve(ROOT, "src/app/api/ops/[...path]/route.ts"),
      "utf-8",
    );
    const expectedRoutes = [
      "agent-runs", "buddy-status", "deal-timeline",
      "intake/funnel", "intake/overrides", "intake/quality",
      "intake/segmentation", "intake/summary", "observer/tick",
      "cleanup-spread-orphans", "mark-dead", "replay-deal",
      "retry-job", "worker-auth/probe",
    ];
    for (const route of expectedRoutes) {
      assert.ok(
        dispatcher.includes(`"${route}"`),
        `ops dispatcher must handle route "${route}"`,
      );
    }
  });

  it("workers catch-all dispatcher handles all original worker sub-routes", () => {
    const dispatcher = readFileSync(
      resolve(ROOT, "src/app/api/workers/[...path]/route.ts"),
      "utf-8",
    );
    const expectedRoutes = [
      "auth-probe", "doc-extraction", "intake-outbox",
      "intake-recovery", "pulse-outbox",
    ];
    for (const route of expectedRoutes) {
      assert.ok(
        dispatcher.includes(`"${route}"`),
        `workers dispatcher must handle route "${route}"`,
      );
    }
  });

  it("model-v2 dispatcher handles all original model-v2 actions", () => {
    const dispatcher = readFileSync(
      resolve(ROOT, "src/app/api/deals/[dealId]/model-v2/[action]/route.ts"),
      "utf-8",
    );
    const expectedActions = [
      "drift", "kick", "parity", "preview",
      "render-diff", "replay", "upgrade-preview",
    ];
    for (const action of expectedActions) {
      assert.ok(
        dispatcher.includes(`"${action}"`),
        `model-v2 dispatcher must handle action "${action}"`,
      );
    }
  });

  it("research dispatcher handles all original research actions", () => {
    const dispatcher = readFileSync(
      resolve(ROOT, "src/app/api/deals/[dealId]/research/[action]/route.ts"),
      "utf-8",
    );
    const expectedActions = [
      "diagnostics", "evidence", "flight-deck", "quality", "run",
    ];
    for (const action of expectedActions) {
      assert.ok(
        dispatcher.includes(`"${action}"`),
        `research dispatcher must handle action "${action}"`,
      );
    }
  });

  // ── 2. _handlers files are not route files ──────────────────────────

  it("_handlers directories contain no route.ts files", () => {
    const handlerRoutes = findFiles(
      "src/app/api -path '*/_handlers/route.ts'",
    );
    assert.equal(
      handlerRoutes.length,
      0,
      `_handlers dirs must not contain route.ts files, found: ${handlerRoutes.join(", ")}`,
    );
  });

  // ── 3. No duplicate route segments ──────────────────────────────────

  it("ops/ has no individual route.ts files outside [...path]", () => {
    const opsRoutes = findFiles(
      "src/app/api/ops -name route.ts",
    );
    assert.equal(
      opsRoutes.length,
      1,
      `ops/ must have exactly 1 route.ts (catch-all), found ${opsRoutes.length}: ${opsRoutes.join(", ")}`,
    );
  });

  it("workers/ has no individual route.ts files outside [...path]", () => {
    const workerRoutes = findFiles(
      "src/app/api/workers -name route.ts",
    );
    const expectedRoutes = [
      "src/app/api/workers/[...path]/route.ts",
      "src/app/api/workers/lock-janitor/route.ts",
    ];
    assert.deepEqual(
      workerRoutes.sort(),
      expectedRoutes.sort(),
      `workers/ must only contain the consolidated catch-all plus lock-janitor: ${workerRoutes.join(", ")}`,
    );
  });

  it("model-v2/ has no individual route.ts files outside [action]", () => {
    const mv2Routes = findFiles(
      "src/app/api/deals/\\[dealId\\]/model-v2 -name route.ts",
    );
    assert.equal(
      mv2Routes.length,
      1,
      `model-v2/ must have exactly 1 route.ts, found ${mv2Routes.length}: ${mv2Routes.join(", ")}`,
    );
  });

  it("research/ has no individual route.ts files outside [action]", () => {
    const researchRoutes = findFiles(
      "src/app/api/deals/\\[dealId\\]/research -name route.ts",
    );
    assert.equal(
      researchRoutes.length,
      1,
      `research/ must have exactly 1 route.ts, found ${researchRoutes.length}: ${researchRoutes.join(", ")}`,
    );
  });

  // ── 4. Route count below warning threshold ──────────────────────────

  // Bumped 1900 -> 1904 on 2026-07-14: SPEC-BROKERAGE-SBA-READY-V1
  // debt-schedule-wiring added one legitimate new route
  // (/api/brokerage/deals/[dealId]/existing-debt) — a borrower-facing CRUD
  // endpoint for existing business debt, distinct enough from the
  // already-existing banker-facing route at the same path under
  // /api/deals/ that merging them would mean branching banker vs. borrower
  // auth inside one handler, which this codebase has hit real cross-tenant
  // bugs from before (see git history: "close cross-tenant data leak").
  //
  // Bumped 1904 -> 1928 on 2026-07-17: SPEC-BROKERAGE-OPERATING-SYSTEM-V1
  // PR1 (unified relationship graph) added people/party-role/dedup/search
  // CRUD endpoints and their CRM UI pages. Two genuinely-redundant route
  // pairs were folded together first (dedup + dedup/merge into one file;
  // people/[personId]/link-organization folded into people/[personId])
  // rather than inflating the threshold to cover them. Still 120 slots
  // under the 2048 hard cap.
  //
  // Bumped 1928 -> 1940 on 2026-07-17: SPEC-BROKERAGE-OPERATING-SYSTEM-V1
  // PR2 (lead/opportunity pipeline engine) added lead detail, qualification,
  // and pipeline UI. The three lead audited-command endpoints (transition
  // stage / record contact attempt / convert) were folded into a single
  // actions/route.ts dispatcher up front — following the ops/[...path] and
  // workers/[...path] catch-all precedent already established in this
  // file — rather than three near-identical route files. Still 108 slots
  // under the 2048 hard cap.
  //
  // Bumped 1940 -> 1952 on 2026-07-17: SPEC-BROKERAGE-OPERATING-SYSTEM-V1
  // PR3 (deal execution / stage gates / tasks) added the deal-workspace
  // summary + audited-actions dispatcher (transition stage / create task /
  // update task / generate stage plan, again one dispatcher file rather
  // than four) plus the management-queues endpoint and its page. The new
  // BrokerageStagePanel mounts inside the existing cockpit rather than
  // adding a second cockpit page. Still 96 slots under the 2048 hard cap.
  it("total slot count stays below 1952 warning threshold", () => {
    const apiRoutes = countRouteFiles();
    const pages = countPageFiles();
    const totalSlots = apiRoutes * 2 + pages * 2;
    assert.ok(
      totalSlots < 1952,
      `Total slot estimate ${totalSlots} (${apiRoutes} routes, ${pages} pages) exceeds 1952 warning threshold`,
    );
  });

  // ── 5. Route count below hard threshold ─────────────────────────────

  it("total slot count stays below 2048 hard cap", () => {
    const apiRoutes = countRouteFiles();
    const pages = countPageFiles();
    const totalSlots = apiRoutes * 2 + pages * 2;
    assert.ok(
      totalSlots < 2048,
      `Total slot estimate ${totalSlots} (${apiRoutes} routes, ${pages} pages) exceeds 2048 hard cap`,
    );
  });

  // ── 6. Consolidated groups retain catch-all route files ─────────────

  it("all consolidated catch-all route files exist", () => {
    const catchAlls = [
      "src/app/api/ops/[...path]/route.ts",
      "src/app/api/workers/[...path]/route.ts",
      "src/app/api/deals/[dealId]/model-v2/[action]/route.ts",
      "src/app/api/deals/[dealId]/research/[action]/route.ts",
      "src/app/api/internal/[...path]/route.ts",
    ];
    for (const f of catchAlls) {
      assert.ok(
        existsSync(resolve(ROOT, f)),
        `Catch-all route file must exist: ${f}`,
      );
    }
  });
});
