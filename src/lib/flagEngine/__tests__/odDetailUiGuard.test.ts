/**
 * SPEC-TAX-RETURN-OTHER-DEDUCTIONS-STATEMENT-SPREADING-3 — CI Guard Tests
 *
 * Guards:
 * 1. RiskClient renders OdDetailPanel for OD-related flags
 * 2. OdDetailPanel fetches from /api/deals/[dealId]/flags/od-detail
 * 3. OD detail API endpoint exists
 * 4. OD detail API supports PATCH for category overrides
 * 5. Flag type includes year_observed for OD detail year context
 * 6. FlagCard passes dealId to OdDetailPanel
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../../..");

function read(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), "utf8");
}

const RISK_CLIENT = read("src/app/(app)/deals/[dealId]/risk/RiskClient.tsx");

describe("SPEC-TAX-RETURN-OTHER-DEDUCTIONS-STATEMENT-SPREADING-3 guards", () => {

  test("Guard 1: RiskClient renders OdDetailPanel for OD flags", () => {
    assert.match(
      RISK_CLIENT,
      /OdDetailPanel/,
      "Must render OdDetailPanel component",
    );
    assert.match(
      RISK_CLIENT,
      /large_other_expense_5pct.*other_deductions_detail_sum_mismatch|other_deductions_detail_sum_mismatch.*large_other_expense_5pct/,
      "Must show OdDetailPanel for both OD-related trigger types",
    );
  });

  test("Guard 2: OdDetailPanel fetches from od-detail API", () => {
    assert.match(
      RISK_CLIENT,
      /\/api\/deals\/\$\{dealId\}\/flags\/od-detail/,
      "Must fetch from od-detail API endpoint",
    );
  });

  test("Guard 3: OD detail API route exists", () => {
    assert.ok(
      existsSync(resolve(repoRoot, "src/app/api/deals/[dealId]/flags/od-detail/route.ts")),
      "od-detail route must exist",
    );
    const route = read("src/app/api/deals/[dealId]/flags/od-detail/route.ts");
    assert.match(route, /OD_DETAIL/, "Route must reference OD_DETAIL fact keys");
    assert.match(route, /deal_financial_facts/, "Route must query deal_financial_facts");
  });

  test("Guard 4: OD detail API supports PATCH for overrides", () => {
    const route = read("src/app/api/deals/[dealId]/flags/od-detail/route.ts");
    assert.match(route, /export async function PATCH/, "Must export PATCH handler");
    assert.match(route, /recategorize|mark_addback|mark_reviewed|mark_non_recurring/, "Must support override actions");
  });

  test("Guard 5: Flag type includes year_observed", () => {
    assert.match(
      RISK_CLIENT,
      /year_observed\??: number/,
      "Flag type must include year_observed for OD detail year context",
    );
  });

  test("Guard 6: FlagCard passes dealId to enable detail fetch", () => {
    assert.match(
      RISK_CLIENT,
      /dealId={dealId}\s*\n?\s*flag={flag}/,
      "FlagCard must receive dealId prop",
    );
  });
});
