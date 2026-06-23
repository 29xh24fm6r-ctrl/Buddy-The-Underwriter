import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LenderRoutingFitWorkspace } from "@/components/lender-routing/LenderRoutingFitWorkspace";
import { LenderRoutingHero } from "@/components/lender-routing/LenderRoutingHero";
import { LenderRoutingOptions } from "@/components/lender-routing/LenderRoutingOptions";
import { LenderFitCriteriaMatrix } from "@/components/lender-routing/LenderFitCriteriaMatrix";
import { LenderRoutingMissingInputs } from "@/components/lender-routing/LenderRoutingMissingInputs";
import { LenderRoutingNextActionCard } from "@/components/lender-routing/LenderRoutingNextActionCard";
import {
  buildLenderRoutingFitViewModel,
  type LenderRoutingFitInput,
  type DealRoutingProfile,
  type LenderCriteriaRecord,
} from "@/lib/banker/buildLenderRoutingFitViewModel";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(over: Partial<LenderRoutingFitInput> = {}): LenderRoutingFitInput {
  return { dealId: "deal-1", ...over };
}

function fullProfile(over: Partial<DealRoutingProfile> = {}): DealRoutingProfile {
  return {
    loanAmount: 500_000,
    state: "CA",
    industry: "Restaurant",
    naicsCode: "722511",
    useOfProceeds: "acquisition",
    businessStage: "existing",
    franchiseStatus: "non_franchise",
    ownerOccupiedRealEstate: false,
    requiredSbaProgram: "7a",
    ...over,
  };
}

function lenderRecord(over: Partial<LenderCriteriaRecord> = {}): LenderCriteriaRecord {
  return {
    id: "lender-a",
    name: "Coastal SBA Lender",
    type: "lender",
    loanAmountMin: 100_000,
    loanAmountMax: 2_000_000,
    acceptedStates: ["CA"],
    acceptedUseOfProceeds: ["acquisition"],
    acceptedIndustries: ["Restaurant"],
    acceptedPrograms: ["7a"],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// 1. Full workspace
// ---------------------------------------------------------------------------

test("LenderRoutingFitWorkspace renders hero, next action, missing inputs, options", () => {
  const vm = buildLenderRoutingFitViewModel(
    makeInput({ dealProfile: fullProfile(), lenderCriteria: [lenderRecord()] }),
  );
  const html = renderToStaticMarkup(
    React.createElement(LenderRoutingFitWorkspace, { viewModel: vm }),
  );
  assert.ok(html.includes("Lender routing intelligence"));
  assert.ok(html.includes("Next routing action"));
  assert.ok(html.includes("Routing inputs needed"));
  assert.ok(html.includes("Routing options"));
});

// ---------------------------------------------------------------------------
// 2. Minimal fallback
// ---------------------------------------------------------------------------

test("workspace renders minimal-state copy safely", () => {
  const vm = buildLenderRoutingFitViewModel(makeInput());
  const html = renderToStaticMarkup(
    React.createElement(LenderRoutingFitWorkspace, { viewModel: vm }),
  );
  assert.ok(html.includes("Gathering routing inputs"));
  assert.ok(html.includes("Routing inputs needed"));
});

// ---------------------------------------------------------------------------
// 3. Hero state badge
// ---------------------------------------------------------------------------

test("LenderRoutingHero renders state-specific badge label", () => {
  const vm = buildLenderRoutingFitViewModel(
    makeInput({ dealProfile: fullProfile() }),
  );
  const html = renderToStaticMarkup(
    React.createElement(LenderRoutingHero, { viewModel: vm }),
  );
  assert.ok(html.includes("Routing options available"));
  assert.ok(
    html.includes("Operational compatibility view"),
    "Hero must include the 'not approval' framing",
  );
});

// ---------------------------------------------------------------------------
// 4. Routing options card
// ---------------------------------------------------------------------------

test("LenderRoutingOptions renders option label, status, and criteria", () => {
  const vm = buildLenderRoutingFitViewModel(
    makeInput({ dealProfile: fullProfile(), lenderCriteria: [lenderRecord()] }),
  );
  const html = renderToStaticMarkup(
    React.createElement(LenderRoutingOptions, { options: vm.options }),
  );
  assert.ok(html.includes("Routing options"));
  assert.ok(html.includes("Coastal SBA Lender"));
  assert.ok(html.includes("Operational fit") || html.includes("Strong operational fit"));
});

test("LenderRoutingOptions renders nothing when options are empty", () => {
  const html = renderToStaticMarkup(
    React.createElement(LenderRoutingOptions, { options: [] }),
  );
  assert.equal(html, "");
});

// ---------------------------------------------------------------------------
// 5. Criteria matrix
// ---------------------------------------------------------------------------

test("LenderFitCriteriaMatrix renders deal + lender values", () => {
  const vm = buildLenderRoutingFitViewModel(
    makeInput({ dealProfile: fullProfile(), lenderCriteria: [lenderRecord()] }),
  );
  const html = renderToStaticMarkup(
    React.createElement(LenderFitCriteriaMatrix, {
      criteria: vm.options[0]!.criteria,
    }),
  );
  assert.ok(html.includes("Deal:"));
  assert.ok(html.includes("Lender:"));
  assert.ok(html.includes("Loan amount range"));
});

test("LenderFitCriteriaMatrix renders nothing for empty list", () => {
  const html = renderToStaticMarkup(
    React.createElement(LenderFitCriteriaMatrix, { criteria: [] }),
  );
  assert.equal(html, "");
});

// ---------------------------------------------------------------------------
// 6. Missing inputs panel
// ---------------------------------------------------------------------------

test("LenderRoutingMissingInputs renders priority pills and reason copy", () => {
  const vm = buildLenderRoutingFitViewModel(makeInput());
  const html = renderToStaticMarkup(
    React.createElement(LenderRoutingMissingInputs, { items: vm.missingInputs }),
  );
  assert.ok(html.includes("Required"));
  assert.ok(html.includes("Loan amount"));
});

test("LenderRoutingMissingInputs renders empty-state copy when no inputs missing", () => {
  const html = renderToStaticMarkup(
    React.createElement(LenderRoutingMissingInputs, { items: [] }),
  );
  assert.ok(html.includes("No routing inputs are currently missing"));
});

// ---------------------------------------------------------------------------
// 7. Next action card
// ---------------------------------------------------------------------------

test("LenderRoutingNextActionCard renders CTA when href present", () => {
  const vm = buildLenderRoutingFitViewModel(
    makeInput({
      dealProfile: fullProfile(),
      prepareOutreachHref: "/banker/deals/deal-1/outreach",
    }),
  );
  const html = renderToStaticMarkup(
    React.createElement(LenderRoutingNextActionCard, { action: vm.nextAction }),
  );
  assert.ok(html.includes("Prepare lender outreach"));
  assert.ok(html.includes('href="/banker/deals/deal-1/outreach"'));
  assert.ok(html.includes("min-h-11"));
});

test("LenderRoutingNextActionCard hides CTA when no href", () => {
  const vm = buildLenderRoutingFitViewModel(makeInput({ dealProfile: fullProfile() }));
  const html = renderToStaticMarkup(
    React.createElement(LenderRoutingNextActionCard, { action: vm.nextAction }),
  );
  assert.equal(html.includes('href="/banker'), false);
});

// ---------------------------------------------------------------------------
// 8. Dark-theme classes (light-theme leak guard)
// ---------------------------------------------------------------------------

test("workspace uses dark-theme color tokens", () => {
  const vm = buildLenderRoutingFitViewModel(
    makeInput({ dealProfile: fullProfile(), lenderCriteria: [lenderRecord()] }),
  );
  const html = renderToStaticMarkup(
    React.createElement(LenderRoutingFitWorkspace, { viewModel: vm }),
  );
  assert.ok(html.includes("text-white"));
  assert.equal(
    /\bbg-stone-50\b/.test(html),
    false,
    "must not leak light-theme bg-stone-50",
  );
});

// ---------------------------------------------------------------------------
// 9. Accessibility
// ---------------------------------------------------------------------------

test("workspace exposes region roles and aria-labels for major sections", () => {
  const vm = buildLenderRoutingFitViewModel(
    makeInput({ dealProfile: fullProfile() }),
  );
  const html = renderToStaticMarkup(
    React.createElement(LenderRoutingFitWorkspace, { viewModel: vm }),
  );
  assert.ok(html.includes('role="region"'));
  assert.ok(html.includes('aria-label="Lender routing &amp; fit workspace"'));
  assert.ok(html.includes('aria-label="Lender routing overview"'));
  assert.ok(html.includes('aria-label="Lender routing options"'));
  assert.ok(html.includes('aria-label="Missing routing inputs"'));
  assert.ok(html.includes('aria-label="Lender routing next action"'));
});

test("criteria and options have non-color-only status pills with aria-labels", () => {
  const vm = buildLenderRoutingFitViewModel(
    makeInput({
      dealProfile: fullProfile(),
      lenderCriteria: [lenderRecord({ acceptedStates: ["NY"] })],
    }),
  );
  const html = renderToStaticMarkup(
    React.createElement(LenderRoutingOptions, { options: vm.options }),
  );
  assert.ok(html.includes("Status: Match") || html.includes("Status: Mismatch"));
  // Type-label is shown explicitly, not encoded only in color
  assert.ok(html.includes("Lender") || html.includes("Channel"));
});

// ---------------------------------------------------------------------------
// 10. No internal enum leakage
// ---------------------------------------------------------------------------

test("workspace does not leak internal enums or tech terms", () => {
  const vm = buildLenderRoutingFitViewModel(
    makeInput({ dealProfile: fullProfile() }),
  );
  const html = renderToStaticMarkup(
    React.createElement(LenderRoutingFitWorkspace, { viewModel: vm }),
  );
  const lower = html.toLowerCase();
  for (const term of [
    "docs_in_progress",
    "lifecycle",
    "credit_memo",
    "classifier",
    "supabase",
    "extraction failed",
    "parser error",
    "fake sla",
    "simulated",
  ]) {
    assert.ok(!lower.includes(term), `Internal term "${term}" leaked`);
  }
});

// ---------------------------------------------------------------------------
// 11. No approval / funding guarantee language
// ---------------------------------------------------------------------------

test("workspace renders no approval/funding/guarantee phrases", () => {
  const vm = buildLenderRoutingFitViewModel(
    makeInput({ dealProfile: fullProfile(), lenderCriteria: [lenderRecord()] }),
  );
  const html = renderToStaticMarkup(
    React.createElement(LenderRoutingFitWorkspace, { viewModel: vm }),
  );
  const lower = html.toLowerCase();
  for (const phrase of [
    "approval odds",
    "guaranteed funding",
    "probability of approval",
    "lender acceptance probability",
    "borrower qualifies",
    "loan will fund",
    "pre-approved",
    "conditional approval",
    "risk score",
    "best lender",
    "credit decision",
    "highest chance",
    "will accept",
    "match score",
    "approval score",
  ]) {
    assert.ok(!lower.includes(phrase), `Forbidden phrase "${phrase}"`);
  }
});

// ---------------------------------------------------------------------------
// 12. No fake acceptance / match-score language
// ---------------------------------------------------------------------------

test("workspace never claims a lender will accept or rank by score", () => {
  const vm = buildLenderRoutingFitViewModel(
    makeInput({ dealProfile: fullProfile(), lenderCriteria: [lenderRecord()] }),
  );
  const html = renderToStaticMarkup(
    React.createElement(LenderRoutingFitWorkspace, { viewModel: vm }),
  );
  const lower = html.toLowerCase();
  assert.ok(!lower.includes("will accept this deal"));
  assert.ok(!lower.includes("approval probability"));
  assert.ok(!lower.includes("score:"));
});

// ---------------------------------------------------------------------------
// 13. No tables / no fake timestamps
// ---------------------------------------------------------------------------

test("workspace renders no tables", () => {
  const vm = buildLenderRoutingFitViewModel(
    makeInput({ dealProfile: fullProfile(), lenderCriteria: [lenderRecord()] }),
  );
  const html = renderToStaticMarkup(
    React.createElement(LenderRoutingFitWorkspace, { viewModel: vm }),
  );
  assert.ok(!html.includes("<table"));
});

test("workspace contains no ISO timestamps when input did not supply any", () => {
  const vm = buildLenderRoutingFitViewModel(
    makeInput({ dealProfile: fullProfile() }),
  );
  const html = renderToStaticMarkup(
    React.createElement(LenderRoutingFitWorkspace, { viewModel: vm }),
  );
  const isoLike = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
  assert.equal(isoLike.test(html), false);
});
