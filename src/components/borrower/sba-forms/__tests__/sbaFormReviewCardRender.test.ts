/**
 * SPEC-M7 ZERO-REPEAT-PREFILL-1 — SbaFormReviewCardBody render tests.
 * Same convention as fixCardsPanelRender.test.ts (M4) / glassBoxPanelRender.test.ts (M3).
 */
import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SbaFormReviewCardBody,
  type BorrowerFormReview,
} from "@/components/borrower/sba-forms/SbaFormReviewCard";
import { FORBIDDEN_BORROWER_TERMS } from "@/lib/portal/borrowerSafeCopy";

function assertNoForbiddenLanguage(html: string) {
  const lower = html.toLowerCase();
  for (const term of FORBIDDEN_BORROWER_TERMS) {
    assert.ok(!lower.includes(term.toLowerCase()), `Forbidden term "${term}"`);
  }
}

test("loading state (null reviews) renders without forbidden language", () => {
  const html = renderToStaticMarkup(
    React.createElement(SbaFormReviewCardBody, { covenant: null, reviews: null }),
  );
  assert.ok(html.includes("Preparing your prefilled forms"));
  assertNoForbiddenLanguage(html);
});

test("renders the covenant counter with real numbers", () => {
  const html = renderToStaticMarkup(
    React.createElement(SbaFormReviewCardBody, {
      covenant: { borrowerAnswered: 47, systemAnswered: 312, totalAnswered: 359 },
      reviews: [],
    }),
  );
  assert.ok(html.includes("47"));
  assert.ok(html.includes("312"));
});

test("a deterministic field renders without a confirm button", () => {
  const review: BorrowerFormReview = {
    formCode: "413",
    fields: [{ key: "full_name", label: "Full legal name", value: "Jane Doe", source: "deterministic", confirmed: true }],
    missingCount: 0,
    isComplete: true,
  };
  const html = renderToStaticMarkup(
    React.createElement(SbaFormReviewCardBody, { covenant: null, reviews: [review] }),
  );
  assert.ok(html.includes("Jane Doe"));
  assert.ok(!html.includes("confirm"));
  assertNoForbiddenLanguage(html);
});

test("an unconfirmed structurer field is highlighted with a confirm action", () => {
  const review: BorrowerFormReview = {
    formCode: "1919",
    fields: [
      { key: "use_of_proceeds:equipment", label: "Equipment", value: 200000, source: "structurer", confirmed: false },
    ],
    missingCount: 0,
    isComplete: true,
  };
  const html = renderToStaticMarkup(
    React.createElement(SbaFormReviewCardBody, {
      covenant: null,
      reviews: [review],
      onConfirmUseOfProceeds: () => {},
    }),
  );
  assert.ok(html.includes("Looks right"));
  assert.ok(html.includes("200,000"));
});

test("a CONFIRMED structurer field shows no confirm action", () => {
  const review: BorrowerFormReview = {
    formCode: "1919",
    fields: [
      { key: "use_of_proceeds:equipment", label: "Equipment", value: 200000, source: "structurer", confirmed: true },
    ],
    missingCount: 0,
    isComplete: true,
  };
  const html = renderToStaticMarkup(
    React.createElement(SbaFormReviewCardBody, {
      covenant: null,
      reviews: [review],
      onConfirmUseOfProceeds: () => {},
    }),
  );
  assert.ok(!html.includes("Looks right"));
});

test("download link is rendered for each form when onDownload is provided", () => {
  const review: BorrowerFormReview = {
    formCode: "413",
    fields: [],
    missingCount: 0,
    isComplete: true,
  };
  const html = renderToStaticMarkup(
    React.createElement(SbaFormReviewCardBody, { covenant: null, reviews: [review], onDownload: () => {} }),
  );
  assert.ok(html.includes("Download Form 413"));
});
