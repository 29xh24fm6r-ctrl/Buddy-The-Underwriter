/**
 * BUGFIX-RISK-PAGE-DEAL-FLAGS-SOURCE-OF-TRUTH-1 — CI Guard Tests
 *
 * Guards:
 * 1. RiskClient fetches from /api/deals/[dealId]/flags (deal_flags table)
 * 2. RiskClient does NOT use spread.flag_report as primary flag source
 * 3. RiskClient has resolve/waive/review actions
 * 4. RiskClient shows "Lifecycle Risk Flags" section header
 * 5. FlagCard has action buttons for open flags
 * 6. Lifecycle blocker reads from deal_flags table
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../../..");

function read(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), "utf8");
}

const RISK_CLIENT = read("src/app/(app)/deals/[dealId]/risk/RiskClient.tsx");
const LIFECYCLE = read("src/buddy/lifecycle/deriveLifecycleState.ts");

describe("BUGFIX-RISK-PAGE-DEAL-FLAGS-SOURCE-OF-TRUTH-1 guards", () => {

  test("Guard 1: RiskClient fetches from /api/deals/[dealId]/flags", () => {
    assert.match(
      RISK_CLIENT,
      /\/api\/deals\/\$\{dealId\}\/flags/,
      "Must fetch lifecycle flags from the deal_flags API",
    );
  });

  test("Guard 2: RiskClient does NOT use spread.flag_report as primary source", () => {
    assert.doesNotMatch(
      RISK_CLIENT,
      /spread\?\.flag_report\?\.flags/,
      "Must not read flags from spread.flag_report — deal_flags is authoritative",
    );
    assert.doesNotMatch(
      RISK_CLIENT,
      /useSpreadOutput/,
      "Must not import useSpreadOutput for flag data",
    );
  });

  test("Guard 3: RiskClient has resolve/waive/review flag actions", () => {
    assert.match(RISK_CLIENT, /handleFlagAction/, "Must have handleFlagAction function");
    assert.match(RISK_CLIENT, /"resolve"/, "Must support resolve action");
    assert.match(RISK_CLIENT, /"waive"/, "Must support waive action");
    assert.match(RISK_CLIENT, /"review"/, "Must support review action");
    assert.match(RISK_CLIENT, /"reopen"/, "Must support reopen action");
  });

  test("Guard 4: RiskClient shows 'Lifecycle Risk Flags' section header", () => {
    assert.match(
      RISK_CLIENT,
      /Lifecycle Risk Flags/,
      "Must label the deal_flags section as 'Lifecycle Risk Flags'",
    );
  });

  test("Guard 5: FlagCard has action buttons for open flags", () => {
    assert.match(RISK_CLIENT, /Mark Reviewed/, "Must have 'Mark Reviewed' button for open flags");
    assert.match(RISK_CLIENT, /Resolve/, "Must have 'Resolve' button");
    assert.match(RISK_CLIENT, /Waive/, "Must have 'Waive' button for reviewed flags");
    assert.match(RISK_CLIENT, /Reopen/, "Must have 'Reopen' button for resolved/waived flags");
  });

  test("Guard 6: lifecycle blocker reads from deal_flags table", () => {
    assert.match(
      LIFECYCLE,
      /from\("deal_flags"\)/,
      "deriveLifecycleState must query deal_flags for critical flag count",
    );
    assert.match(
      LIFECYCLE,
      /criticalFlagsResolved/,
      "Must derive criticalFlagsResolved from deal_flags count",
    );
  });
});
