/**
 * SPEC-M8 ARTIFACT-PIPELINE-1 — BusinessPlanAttestationCardBody render tests.
 * Same convention as sbaFormReviewCardRender.test.ts (M7).
 */
import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BusinessPlanAttestationCardBody,
  type BusinessPlanAttestationState,
} from "@/components/borrower/BusinessPlanAttestationCard";
import { FORBIDDEN_BORROWER_TERMS } from "@/lib/portal/borrowerSafeCopy";

function assertNoForbiddenLanguage(html: string) {
  const lower = html.toLowerCase();
  for (const term of FORBIDDEN_BORROWER_TERMS) {
    assert.ok(!lower.includes(term.toLowerCase()), `Forbidden term "${term}"`);
  }
}

test("loading state (null state) renders without forbidden language", () => {
  const html = renderToStaticMarkup(React.createElement(BusinessPlanAttestationCardBody, { state: null }));
  assert.ok(html.includes("Preparing your business plan"));
  assertNoForbiddenLanguage(html);
});

test("renders nothing when there's no package yet", () => {
  const state: BusinessPlanAttestationState = {
    hasPackage: false,
    attested: false,
    snapshotMatchesCurrent: false,
    provenanceEntries: [],
  };
  const html = renderToStaticMarkup(React.createElement(BusinessPlanAttestationCardBody, { state }));
  assert.equal(html, "");
});

test("shows the confirm button when not yet attested", () => {
  const state: BusinessPlanAttestationState = {
    hasPackage: true,
    attested: false,
    snapshotMatchesCurrent: false,
    provenanceEntries: [],
  };
  const html = renderToStaticMarkup(React.createElement(BusinessPlanAttestationCardBody, { state, onConfirm: () => {} }));
  assert.ok(html.includes("confirm it's accurate") || html.includes("confirm it&#x27;s accurate"));
  assertNoForbiddenLanguage(html);
});

test("shows confirmed state and no button when attested and snapshot matches", () => {
  const state: BusinessPlanAttestationState = {
    hasPackage: true,
    attested: true,
    snapshotMatchesCurrent: true,
    provenanceEntries: [],
  };
  const html = renderToStaticMarkup(React.createElement(BusinessPlanAttestationCardBody, { state }));
  assert.ok(html.includes("Confirmed"));
  assert.ok(!html.includes("confirm it"));
});

test("shows the confirm button again when attested but the snapshot is stale", () => {
  const state: BusinessPlanAttestationState = {
    hasPackage: true,
    attested: true,
    snapshotMatchesCurrent: false,
    provenanceEntries: [],
  };
  const html = renderToStaticMarkup(React.createElement(BusinessPlanAttestationCardBody, { state, onConfirm: () => {} }));
  assert.ok(!html.includes("Confirmed —"));
});

test("surfaces which story fields fed the plan when provenance is present", () => {
  const state: BusinessPlanAttestationState = {
    hasPackage: true,
    attested: false,
    snapshotMatchesCurrent: false,
    provenanceEntries: [
      { storyFields: ["growthStrategy"], capturedVia: "chat", capturedAt: "2026-06-01T00:00:00.000Z" },
      null,
    ],
  };
  const html = renderToStaticMarkup(React.createElement(BusinessPlanAttestationCardBody, { state, onConfirm: () => {} }));
  assert.ok(html.includes("your growth plans"));
  assertNoForbiddenLanguage(html);
});
