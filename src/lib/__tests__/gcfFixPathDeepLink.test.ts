import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { getBlockerFixAction } from "@/buddy/lifecycle/nextAction";

/**
 * SPEC-GCF-FIXPATH-DEEP-LINK-1 regression guard.
 *
 * The missing_global_cash_flow blocker's Fix Now used to route to
 * /deals/[dealId]/spreads, which opens on the read-only Executive Summary tab
 * with no GCF resolution action — stranding the banker mid guided-fix. It must
 * now deep-link to the Global Cash Flow sub-page, which shows a prominent
 * "Global Cash Flow required" banner with a Compute action.
 *
 * (The Memo Inputs panel's behavioral fixPath is asserted in
 * evaluateMemoInputReadiness.test.ts [input-8b]; this file covers the cockpit
 * nextAction mapper and the GCF page's resolution UI.)
 */

const root = process.cwd();
const DEAL_ID = "deal-xyz";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(root, rel), "utf8");
}

const GCF_PAGE =
  "src/app/(app)/deals/[dealId]/spreads/global-cash-flow/page.tsx";

test("cockpit nextAction deep-links missing_global_cash_flow to the GCF sub-page", () => {
  const action = getBlockerFixAction(
    { code: "missing_global_cash_flow" } as any,
    DEAL_ID,
  );
  assert.ok(action, "must return a fix action");
  assert.equal(
    (action as any).href,
    `/deals/${DEAL_ID}/spreads/global-cash-flow`,
  );
});

// SPEC-FINANCIALS-BEFORE-GCF-SEQUENCING-1: DSCR is the most-downstream financial
// metric (depends on GCF, which depends on business financials + ADS). The cockpit
// fix action routes missing_dscr to the upstream financial-analysis hub — NOT the
// generic /spreads, and NOT the GCF compute page that can't clear DSCR yet.
test("missing_dscr routes to the upstream financial hub, not /spreads or a GCF dead-end", () => {
  const action = getBlockerFixAction({ code: "missing_dscr" } as any, DEAL_ID);
  assert.ok(action, "must return a fix action for missing_dscr");
  assert.equal((action as any).href, `/deals/${DEAL_ID}/financials`);
  assert.notEqual(
    (action as any).href,
    `/deals/${DEAL_ID}/spreads`,
    "missing_dscr must NOT route to the generic /spreads page",
  );
  assert.notEqual(
    (action as any).href,
    `/deals/${DEAL_ID}/spreads/global-cash-flow`,
    "missing_dscr must NOT dead-end on the GCF compute page",
  );
});

test("missing_debt_service_facts still routes to /spreads (scope contained)", () => {
  const action = getBlockerFixAction(
    { code: "missing_debt_service_facts" } as any,
    DEAL_ID,
  );
  assert.ok(action, "must return a fix action for missing_debt_service_facts");
  assert.equal((action as any).href, `/deals/${DEAL_ID}/spreads`);
});

test("GCF page shows a prominent 'required' banner when GCF is missing", () => {
  const src = read(GCF_PAGE);
  assert.ok(
    /Global Cash Flow required/.test(src),
    "must render a 'Global Cash Flow required' banner",
  );
  // Banner is gated on the same missing-value condition that drives the blocker.
  // (Per SPEC-GCF-COMPUTE-QUEUED-POLLING-AND-STATUS-1 this is now the "missing"
  // view of an explicit state machine, computed via hasGcfValue.)
  assert.ok(
    /view === "missing"/.test(src) && /hasGcfValue/.test(src),
    "banner must be gated on the GCF value actually being absent",
  );
  // It is rendered above the fold (before the loading/table conditional).
  const bannerIdx = src.indexOf("Global Cash Flow required");
  const tableIdx = src.indexOf("<SpreadTable");
  assert.ok(bannerIdx !== -1 && tableIdx !== -1, "both banner and table exist");
  assert.ok(
    bannerIdx < tableIdx,
    "the required banner must appear above the spread table",
  );
});

test("GCF page offers a Compute action wired to the recompute endpoint", () => {
  const src = read(GCF_PAGE);
  assert.ok(
    /Compute Global Cash Flow/.test(src),
    "must offer a 'Compute Global Cash Flow' action",
  );
  assert.ok(
    /\/api\/deals\/\$\{dealId\}\/spreads\/recompute/.test(src),
    "compute must POST the banker-initiated spreads recompute endpoint",
  );
  assert.ok(
    /types:\s*\["GLOBAL_CASH_FLOW"\]/.test(src),
    "recompute must target the GLOBAL_CASH_FLOW spread type",
  );
  // Auto-refresh while the computation runs (no manual reload dead-end).
  // Polling now covers queued + generating via isActiveSpread (see
  // SPEC-GCF-COMPUTE-QUEUED-POLLING-AND-STATUS-1).
  assert.ok(
    /spreads\.some\(isActiveSpread\)/.test(src),
    "page must poll while the spread is queued or generating",
  );
});
