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

test("sibling financial blockers still route to /spreads (scope contained)", () => {
  for (const code of ["missing_dscr", "missing_debt_service_facts"]) {
    const action = getBlockerFixAction({ code } as any, DEAL_ID);
    assert.ok(action, `must return a fix action for ${code}`);
    assert.equal(
      (action as any).href,
      `/deals/${DEAL_ID}/spreads`,
      `${code} must be unchanged`,
    );
  }
});

test("GCF page shows a prominent 'required' banner when GCF is missing", () => {
  const src = read(GCF_PAGE);
  assert.ok(
    /Global Cash Flow required/.test(src),
    "must render a 'Global Cash Flow required' banner",
  );
  // Banner is gated on the same missing-value condition that drives the blocker.
  assert.ok(
    /gcfMissing/.test(src) && /gcfValuePresent/.test(src),
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
  assert.ok(
    /status === "generating"/.test(src),
    "page must poll while the spread is generating",
  );
});
