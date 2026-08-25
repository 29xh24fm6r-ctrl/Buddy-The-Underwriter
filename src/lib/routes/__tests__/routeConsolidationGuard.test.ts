/**
 * SPEC-ROUTE-CONSOLIDATION-1 — Route consolidation invariant guards
 *
 * Proves:
 *   1. Consolidated route groups expose the same public URL patterns
 *   2. _handlers files are not counted as route files
 *   3. No duplicate route segment accidentally reappears
 *   4. Route count stays below warning threshold (see MERGED_WARNING_THRESHOLD)
 *   5. Route count stays below hard threshold (2048)
 *   6. Consolidated groups retain their catch-all route files
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../../../..");

// See the "Bumped ... on ..." comment trail below the warning-threshold
// test for the history of this number. Actual measured total as of the
// 2026-07-19 merge of SPEC-SBA-DOC-FILL-ESIGN-KYC-V2 and
// SPEC-BROKERAGE-OPERATING-SYSTEM-V1 PR5 (both bumped this independently
// off the same 1952 base): 790 route.ts * 2 + 192 page.tsx * 2 = 1964.
//
// Bumped 1970 -> 1980 on 2026-07-24: fixing 7 stale-fetch 404s
// (check:api-fetches) added 2 net-new route.ts files —
// /deals/[dealId]/status and /deals/[dealId]/uploads/status — each
// needing their own file (no existing sibling shares their exact URL
// prefix). portal/share's view+upload actions were consolidated into one
// [action] dispatcher (net zero new files). A third planned addition,
// /deals/[dealId]/messages/[messageId] (DELETE), turned out unnecessary —
// its only caller, ConditionMessagingCard.tsx, was removed by an
// unrelated main-branch commit before this merged, so the route was
// dropped rather than landing dead. Actual measured total: 793 route.ts *
// 2 + 192 page.tsx * 2 = 1970. Still 78 slots under the 2048 hard cap.
//
// Bumped 1980 -> 1990 on 2026-07-29: SPEC-M8 ARTIFACT-PIPELINE-1 added one
// new route, /api/portal/[token]/business-plan/attestation (borrower
// review + attestation of the AI-generated SBA business plan — a genuinely
// new resource, not foldable into the existing sba-forms route's
// different auth/data shape). The other 4 route.ts files behind this
// bump's headroom landed via unrelated parallel main-branch merges between
// 07-24 and 07-29. Actual measured total: 798 route.ts * 2 + 192 page.tsx *
// 2 = 1980. Still 58 slots under the 2048 hard cap.
//
// Bumped 1990 -> 2000 on 2026-08-03: SPEC-SBA-FORM-COMPLETION-V1 added 3
// new routes under /deals/[dealId]/sba/ — character-questions (§3.C
// explicit confirmation of criminal-history answers), completeness-gate
// (§7 per-form completeness check), and intake-completeness (§3 intake
// data gap closure). Each serves a distinct resource that cannot fold into
// existing SBA routes. 2 additional route.ts files arrived from upstream
// merges since the last bump. Actual measured total: 803 route.ts * 2 +
// 192 page.tsx * 2 = 1990. Still 48 slots under the 2048 hard cap.
//
// Bumped 2000 -> 2002 on 2026-08-11: Sign Back In feature added 1 new
// page at /welcome-back (returning-borrower identity verification).
// Actual measured total after the consolidated Buddy LOS provider route:
// 808 route.ts * 2 + 193 page.tsx * 2 = 2002. The provider's health and
// document-intelligence endpoints share one catch-all dispatcher rather than
// consuming two route files. Still 44 slots under the 2048 hard cap.
//
// Bumped 2006 -> 2012 on 2026-08-25: the Didit completion fix added one
// page and one route. /kyc/complete is the URL Didit already sends
// borrowers back to after verifying — production logs show four requests
// to it on 2026-08-25 against no route at all, so a borrower who finished
// verification was returned to a dead URL; it cannot fold into another
// page because the vendor holds the path. /api/borrower/portal/[token]/owners
// carries owner edit/delete, which cannot fold into the sibling identity
// route without conflating two resources on one dispatcher (that route
// already carries GET+POST for verification state). Actual measured
// total: 810 route.ts * 2 + 194 page.tsx * 2 = 2008. Still 40 slots under
// the 2048 hard cap.
const MERGED_WARNING_THRESHOLD = 2012;

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
  //
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
  //
  // Bumped 1952 -> 1954 on 2026-07-18: SPEC-SBA-DOC-FILL-ESIGN-KYC-V2 —
  // Form 413's itemized PFS schedules (notes payable/securities/real
  // estate) had no writer anywhere; added one GET/POST/PATCH/DELETE
  // dispatcher keyed by a `[scheduleType]` dynamic segment (not 3
  // resources x 2 files — PATCH/DELETE take `item_id` in the body rather
  // than a `[itemId]` segment) — same one-dispatcher-not-N-files
  // precedent as ops/[...path]/workers/[...path] above. No new page. This
  // was already at the ceiling (0 slots of headroom), so even the single
  // consolidated file needed this bump. Still 94 slots under the 2048
  // hard cap.
  //
  // Bumped 1952 -> 1975 on 2026-07-17 (developed in parallel on a
  // different branch, merged 2026-07-19): SPEC-BROKERAGE-OPERATING-SYSTEM-V1
  // PR5 (intelligence, analytics, revenue, command center) added 5 route
  // files, each already a query-param/action dispatcher rather than one
  // route per read/write (crm/intelligence covers relationship-score,
  // referral-analytics, lender-performance, revenue, and forecast behind
  // one GET; crm/intelligence/alerts covers list+dismiss+snooze+
  // acknowledge; crm/intelligence/ai-assist covers all 5 AI actions;
  // command-center aggregates every panel into one response;
  // deals/[dealId]/commission-splits covers list/initialize/recalculate/
  // update-status). One new page (command-center) — relationship-score,
  // referral-analytics, lender-performance, and commission-split UI were
  // mounted into the existing org/lenders/deal-cockpit pages instead of
  // new pages. Still 73 slots under the 2048 hard cap.
  //
  // Merged 2026-07-19: both bumps land on main together. Threshold set to
  // the actual post-merge total (see below) plus headroom, not just the
  // sum of the two deltas, since the two branches' route additions don't
  // stack in a simple arithmetic way once merged.
  // Bumped 2004 -> 2006 on 2026-08-17 (launch sprint): ONE new route file,
  // src/app/api/borrower/portal/[token]/documents/route.ts, carrying GET
  // (list what I uploaded) and DELETE (withdraw my own mistake) behind a
  // single dispatcher rather than two files — the same one-dispatcher
  // precedent as the entries above.
  //
  // Why it could not be folded into an existing route: the borrower upload
  // path had NO listing endpoint at all, and production has zero
  // borrower_portal_links rows, so no self-serve borrower could see or
  // manage an uploaded document. The portal hub route is a read-only
  // aggregator returning counts; hanging a destructive DELETE off it would
  // hide a mutation inside a dashboard fetch.
  //
  // Still 42 slots under the 2048 hard cap.
  it("total slot count stays below the merged warning threshold", () => {
    const apiRoutes = countRouteFiles();
    const pages = countPageFiles();
    const totalSlots = apiRoutes * 2 + pages * 2;
    assert.ok(
      totalSlots < MERGED_WARNING_THRESHOLD,
      `Total slot estimate ${totalSlots} (${apiRoutes} routes, ${pages} pages) exceeds ${MERGED_WARNING_THRESHOLD} warning threshold`,
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
