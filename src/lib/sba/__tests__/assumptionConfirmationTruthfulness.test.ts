import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  computeAssumptionsCompletionPct,
  validateSBAAssumptions,
} from "../sbaAssumptionsValidator";
import type { SBAAssumptions } from "../sbaReadinessTypes";

const route = readFileSync(
  "src/app/api/deals/[dealId]/sba/route.ts",
  "utf8",
);
const client = readFileSync(
  "src/components/sba/AssumptionInterview.tsx",
  "utf8",
);

function completeLookingAssumptions(): SBAAssumptions {
  return {
    dealId: "deal-fixture",
    status: "complete",
    revenueStreams: [
      {
        id: "revenue-1",
        name: "",
        baseAnnualRevenue: 500_000,
        growthRateYear1: 0.1,
        growthRateYear2: 0.08,
        growthRateYear3: 0.06,
        pricingModel: "flat",
        seasonalityProfile: null,
      },
    ],
    costAssumptions: {
      cogsPercentYear1: 0.35,
      cogsPercentYear2: 0.34,
      cogsPercentYear3: 0.33,
      fixedCostCategories: [],
      plannedHires: [],
      plannedCapex: [],
    },
    workingCapital: {
      targetDSO: 30,
      targetDPO: 20,
      inventoryTurns: null,
    },
    loanImpact: {
      loanAmount: 750_000,
      termMonths: 120,
      interestRate: 0.09,
      existingDebt: [],
      equityInjectionAmount: 100_000,
      equityInjectionSource: "cash_savings",
      sellerFinancingAmount: 0,
      sellerFinancingTermMonths: 0,
      sellerFinancingRate: 0,
      otherSources: [],
    },
    managementTeam: [
      {
        name: "Alex Owner",
        title: "President",
        yearsInIndustry: 8,
        bio: "Too short",
      },
    ],
  };
}

test("completion percentage cannot substitute for canonical validation", () => {
  const assumptions = completeLookingAssumptions();

  assert.equal(computeAssumptionsCompletionPct(assumptions), 100);
  const validation = validateSBAAssumptions(assumptions);
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.ok(
      validation.blockers.some((blocker) =>
        blocker.includes("revenue streams must have a name"),
      ),
    );
    assert.ok(
      validation.blockers.some((blocker) =>
        blocker.includes("bio must be at least 20 characters"),
      ),
    );
  }
});

test("confirmation validates canonical state before the persistence boundary", () => {
  const loadIndex = route.indexOf('select(\n        "id, status, revenue_streams');
  const validationIndex = route.indexOf("validateSBAAssumptions(candidate)");
  const upsertIndex = route.indexOf('.upsert(upsertData, { onConflict: "deal_id" })');

  assert.ok(loadIndex > 0, "confirmation must load canonical assumptions");
  assert.ok(validationIndex > loadIndex, "validation must follow the canonical read");
  assert.ok(upsertIndex > validationIndex, "validation must precede persistence");
  assert.match(route, /if \(loadError\)/);
  assert.match(route, /error: "assumptions_missing"/);
  assert.match(route, /error: "assumptions_invalid"/);
  assert.match(route, /validation\.blockers/);
  assert.match(route, /\.select\("id, status, confirmed_at"\)\s*\.maybeSingle\(\)/s);
  assert.match(route, /!saved\?\.id/);
  assert.match(route, /saved\.status !== patch\.status/);
  assert.match(route, /patch\.status === "confirmed" \? now : null/);
});

test("client reports mutation failures and launches generation only after confirmation proof", () => {
  const confirmStart = client.indexOf("const handleConfirm = async");
  const confirmEnd = client.indexOf("const handleReopen = async");
  const confirm = client.slice(confirmStart, confirmEnd);
  const serverProofIndex = confirm.indexOf('result.status !== "confirmed"');
  const stateChangeIndex = confirm.indexOf('status: "confirmed"');
  const generationIndex = confirm.indexOf("await runStreamingGenerate()");

  assert.ok(confirmStart > 0 && confirmEnd > confirmStart);
  assert.match(client, /"idle" \| "saving" \| "saved" \| "error"/);
  assert.match(client, /if \(!response\.ok \|\| !result\?\.ok\)/);
  assert.match(client, /setSaveStatus\("error"\)/);
  assert.match(client, /validateSBAAssumptions\(assumptions\)/);
  assert.ok(serverProofIndex > 0, "client must require confirmed server state");
  assert.ok(
    stateChangeIndex > serverProofIndex,
    "client must not mark confirmed before server proof",
  );
  assert.ok(
    generationIndex > stateChangeIndex,
    "generation must follow proven confirmation",
  );
  assert.match(client, /result\.status !== "draft"/);
  assert.match(client, /Assumptions were not changed:/);
});
