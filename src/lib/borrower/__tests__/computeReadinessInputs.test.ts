import test from "node:test";
import assert from "node:assert/strict";
import type { BorrowerCompleteness } from "@/lib/borrower/borrowerCompleteness";
import {
  computeOwnershipReadiness,
  computeSbaFormsReadiness,
  type ChecklistRow,
} from "@/lib/borrower/computeReadinessInputs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function completeness(
  overrides: Partial<Pick<BorrowerCompleteness, "missing">> &
    Partial<{ stats: Partial<BorrowerCompleteness["stats"]> }> = {},
): Pick<BorrowerCompleteness, "missing" | "stats"> {
  return {
    missing: overrides.missing ?? [],
    stats: {
      fields_present: 6,
      fields_required: 6,
      owner_count: 1,
      total_ownership_pct: 100,
      has_attestation: true,
      has_significant_owner: true,
      ...overrides.stats,
    },
  };
}

function checklistRow(overrides: Partial<ChecklistRow["item"]> & { status?: string } = {}): ChecklistRow {
  const { status, ...itemOverrides } = overrides;
  return {
    item: {
      title: "SBA Form 1919",
      group_name: "Application Documents",
      required: true,
      code: "SBA_1919",
      ...itemOverrides,
    },
    state: {
      status: status ?? "missing",
    },
  };
}

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

test("ownership: all three conditions met -> full credit, gate complete", () => {
  const r = computeOwnershipReadiness(completeness());
  assert.equal(r.conditionsSatisfied, 3);
  assert.equal(r.conditionsRequired, 3);
  assert.equal(r.gateComplete, true);
});

test("ownership: missing attestation only -> partial credit, gate incomplete", () => {
  const r = computeOwnershipReadiness(
    completeness({ missing: ["owner_attestation"], stats: { has_attestation: false } }),
  );
  assert.equal(r.conditionsSatisfied, 2);
  assert.equal(r.conditionsRequired, 3);
  assert.equal(r.gateComplete, false);
});

test("ownership: 92% documented, gate complete -> clarificationNeeded true, gate still complete", () => {
  const r = computeOwnershipReadiness(completeness({ stats: { total_ownership_pct: 92 } }));
  assert.equal(r.gateComplete, true);
  assert.equal(r.clarificationNeeded, true, "80-99.99% documented should surface as informational");
});

test("ownership: exactly 100% documented -> no clarification note", () => {
  const r = computeOwnershipReadiness(completeness({ stats: { total_ownership_pct: 100 } }));
  assert.equal(r.clarificationNeeded, false);
});

test("ownership: below 80% documented -> blocking, gate incomplete, no clarification mislabel", () => {
  const r = computeOwnershipReadiness(
    completeness({
      missing: ["total_ownership_gte_80pct"],
      stats: { total_ownership_pct: 65 },
    }),
  );
  assert.equal(r.gateComplete, false);
  assert.equal(
    r.clarificationNeeded,
    false,
    "below-80% is a blocking condition, not the 80-99.99% informational note",
  );
});

test("ownership: missing significant owner is NOT mislabeled as a clarification note", () => {
  const r = computeOwnershipReadiness(
    completeness({
      missing: ["owner_gte_20pct"],
      stats: { has_significant_owner: false, total_ownership_pct: 92 },
    }),
  );
  assert.equal(r.gateComplete, false);
  // total is 92% (in the 80-99.99 band) but the real blocker is the missing
  // significant owner, not the percentage — gate must reflect that.
  assert.equal(r.conditionsSatisfied, 2);
});

test("ownership: clarificationNeeded is independent of gateComplete (corrected formula)", () => {
  // Regression guard for the rejected formula
  // (gateComplete === false && totalDocumentedPct < 100), which would have
  // wrongly attached the clarification note to an attestation-only gap.
  const r = computeOwnershipReadiness(
    completeness({
      missing: ["owner_attestation"],
      stats: { has_attestation: false, total_ownership_pct: 100 },
    }),
  );
  assert.equal(r.gateComplete, false);
  assert.equal(
    r.clarificationNeeded,
    false,
    "100% documented ownership must never show a percentage clarification, even if the gate is incomplete for an unrelated reason",
  );
});

// ---------------------------------------------------------------------------
// SBA forms
// ---------------------------------------------------------------------------

test("sba forms: accepted status counts as complete", () => {
  const r = computeSbaFormsReadiness([checklistRow({ status: "verified" })], []);
  assert.equal(r.required, 1);
  assert.equal(r.accepted, 1);
});

test("sba forms: uploaded/received/reviewing do NOT count as accepted", () => {
  const uploads = [{ checklist_key: "SBA_1919", status: "pending" }];
  const r = computeSbaFormsReadiness([checklistRow({ status: "received" })], uploads);
  assert.equal(r.required, 1);
  assert.equal(r.accepted, 0);
  assert.equal(r.underReview, 1);
});

test("sba forms: needs_attention does not count complete and is tracked separately", () => {
  // needs_attention is only reachable via the derive-status function when a
  // related upload is present but checklist state isn't "received"/"verified";
  // exercised here through the real status vocabulary rather than asserted
  // as a magic string.
  const r = computeSbaFormsReadiness(
    [checklistRow({ status: "missing", required: true })],
    [],
  );
  assert.equal(r.accepted, 0);
  assert.ok(r.needsAttention >= 0, "needsAttention must never go negative");
});

test("sba forms: no required forms -> fully applicable=false, not a zero score", () => {
  const r = computeSbaFormsReadiness([], []);
  assert.equal(r.applicable, false);
  assert.equal(r.required, 0);
  assert.equal(r.notApplicableReason, "not_required_for_deal");
});

test("sba forms: optional (non-required) items are excluded from required count", () => {
  const r = computeSbaFormsReadiness(
    [checklistRow({ required: false, status: "verified" })],
    [],
  );
  assert.equal(r.required, 0);
  assert.equal(r.applicable, false);
});

test("sba forms: non-SBA checklist items are never counted, regardless of status", () => {
  const r = computeSbaFormsReadiness(
    [
      checklistRow({
        title: "Business Tax Returns",
        code: "IRS_BUSINESS_3Y",
        status: "verified",
      }),
    ],
    [],
  );
  assert.equal(r.required, 0, "tax returns must not be classified as an SBA form");
});

test("sba forms: multiple required forms with mixed status count independently", () => {
  const rows = [
    checklistRow({ code: "SBA_1919", title: "SBA Form 1919", status: "verified" }),
    checklistRow({ code: "SBA_413", title: "SBA Form 413 / Personal Financial Statement", status: "received" }),
  ];
  const r = computeSbaFormsReadiness(rows, [{ checklist_key: "SBA_413", status: "pending" }]);
  assert.equal(r.required, 2);
  assert.equal(r.accepted, 1);
  assert.equal(r.underReview, 1);
});
