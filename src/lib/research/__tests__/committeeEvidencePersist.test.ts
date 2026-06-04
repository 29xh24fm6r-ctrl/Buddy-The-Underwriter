import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

/**
 * SPEC-BIE-PERSIST-COMMITTEE-EVIDENCE-TASK-STATUS-1
 *
 * The #484 enrichment (committeeEvidenceLinkage) is now persisted to durable
 * columns on buddy_research_committee_tasks. These tests pin the PURE row
 * builder + item-bucket derivation that produce what gets written — proving
 * collected / needs_review / missing / coverage checklist / auto_clear_forbidden
 * all persist, and that the banker workflow `status` is never written (no
 * auto-clearing a committee blocker / no gate change).
 */

mockServerOnly();
const require_ = createRequire(import.meta.url);
const {
  enrichCommitteeTasks,
  deriveTaskItemBuckets,
  buildCommitteeTaskPersistRow,
} = require_("@/lib/research/committeeEvidenceLinkage") as typeof import("@/lib/research/committeeEvidenceLinkage");

type Task = import("@/lib/research/committeeEvidenceTasks").CommitteeEvidenceTask;

function task(over: Partial<Task>): Task {
  return { id: "t1", blocker_id: "b1", task_type: "manual_review", status: "pending", ...over } as Task;
}

const NOW = "2026-06-04T00:00:00.000Z";

// OmniCare-like file context: rich loan file, weak public web (mirrors #484).
const OMNICARE_INPUT = {
  evidenceRows: [
    { id: "e1", thread_origin: "competitive", claim: "Competes with X" }, // unsourced → needs_review
    { id: "e2", thread_origin: "management", claim: "Matt Hunt, President" },
  ],
  documents: [
    { id: "d1", canonical_type: "INCOME_STATEMENT", original_filename: "is.pdf" },
    { id: "d2", canonical_type: "BUSINESS_TAX_RETURN" },
    { id: "d3", canonical_type: "AR_AGING" },
  ],
  financialFacts: [{ fact_key: "DSCR" }, { fact_key: "GCF_DSCR" }, { fact_key: "TOTAL_REVENUE" }, { fact_key: "ELIGIBLE_AR" }],
  borrowerStory: { products_services: "BPO/call center", customer_concentration: "Top client 40%", competitive_position: "Regional", website: "www.omnicare365.com" },
  managementProfiles: [{ id: "m1", person_name: "Matt Hunt", title: "President" }],
  subject: { website: "www.omnicare365.com" },
};

// ── coverage checklist persists ───────────────────────────────────────────────

test("[persist] coverage checklist + item buckets persist (DSCR/financials/collateral collected, loan request + sources missing, mgmt needs_review)", () => {
  const enriched = enrichCommitteeTasks(
    [task({ task_type: "financial_file", blocker_type: "evidence_coverage" })],
    OMNICARE_INPUT,
  )[0];
  const row = buildCommitteeTaskPersistRow(enriched, NOW);

  // coverage checklist persists verbatim
  assert.ok(Array.isArray(row.coverage_checklist) && row.coverage_checklist.length === 7);

  // collected persists
  assert.ok(row.collected_items.includes("DSCR"));
  assert.ok(row.collected_items.includes("Financial statements / tax returns"));
  assert.ok(row.collected_items.includes("Products / services"));
  assert.ok(row.collected_items.includes("Collateral records"));
  // missing persists
  assert.ok(row.missing_items.includes("Loan request / use of proceeds"));
  assert.ok(row.missing_items.includes("Primary/institutional sources"));
  // needs_review persists
  assert.ok(row.needs_review_items.includes("Management publicly verified"));

  assert.equal(row.last_linked_at, NOW);
});

// ── single-status tasks persist their own status ──────────────────────────────

test("[persist] collected single-status task persists into collected_items", () => {
  const enriched = enrichCommitteeTasks(
    [task({ task_type: "borrower_website_snapshot", title: "Snapshot the borrower's official website" })],
    { ...OMNICARE_INPUT, evidenceRows: [{ id: "w", source_types: ["borrower_official_website"], source_uris: ["https://www.omnicare365.com"], claim: "home" }] },
  )[0];
  const row = buildCommitteeTaskPersistRow(enriched, NOW);
  assert.equal(row.file_status, "collected");
  assert.equal(row.resolved_status, "collected");
  assert.deepEqual(row.collected_items, ["Snapshot the borrower's official website"]);
  assert.deepEqual(row.missing_items, []);
});

test("[persist] needs_review single-status task persists into needs_review_items", () => {
  const enriched = enrichCommitteeTasks(
    [task({ task_type: "management_attestation", title: "Attach management/ownership attestation" })],
    OMNICARE_INPUT,
  )[0];
  const row = buildCommitteeTaskPersistRow(enriched, NOW);
  assert.equal(row.file_status, "needs_review");
  assert.deepEqual(row.needs_review_items, ["Attach management/ownership attestation"]);
});

test("[persist] missing single-status task persists into missing_items", () => {
  const enriched = enrichCommitteeTasks(
    [task({ task_type: "public_adverse_screen", title: "Run public adverse-record screen" })],
    OMNICARE_INPUT,
  )[0];
  const row = buildCommitteeTaskPersistRow(enriched, NOW);
  assert.equal(row.file_status, "missing");
  assert.deepEqual(row.missing_items, ["Run public adverse-record screen"]);
});

// ── scale_plausibility never auto-clears ──────────────────────────────────────

test("[persist] scale_plausibility contradiction persists auto_clear_forbidden=true and never 'collected'", () => {
  const enriched = enrichCommitteeTasks(
    [task({ task_type: "manual_review", blocker_type: "contradiction_gap", blocker_id: "scale_plausibility", title: "Contradiction unresolved: scale plausibility" })],
    OMNICARE_INPUT,
  )[0];
  const row = buildCommitteeTaskPersistRow(enriched, NOW);
  assert.equal(row.auto_clear_forbidden, true);
  assert.notEqual(row.resolved_status, "collected");
  assert.equal(row.file_status, "needs_review");
});

test("[persist] scale_plausibility routed as financial_file caps at needs_review and forbids auto-clear", () => {
  const enriched = enrichCommitteeTasks(
    [task({ task_type: "financial_file", blocker_type: "contradiction_gap", blocker_id: "scale_plausibility", title: "Contradiction unresolved: scale plausibility" })],
    OMNICARE_INPUT,
  )[0];
  const row = buildCommitteeTaskPersistRow(enriched, NOW);
  assert.equal(row.auto_clear_forbidden, true);
  assert.notEqual(row.resolved_status, "collected");
  assert.ok(row.coverage_checklist.length > 0);
});

// ── persistence must NOT touch the banker workflow status / gate ──────────────

test("[persist] persisted row never includes the banker workflow `status` column", () => {
  const enriched = enrichCommitteeTasks([task({ task_type: "financial_file", status: "pending" })], OMNICARE_INPUT)[0];
  const row = buildCommitteeTaskPersistRow(enriched, NOW) as Record<string, unknown>;
  assert.equal("status" in row, false, "persisting must never write `status` (no auto-clearing a committee blocker)");
});

test("[persist] banker action (accepted/rejected) persists into resolved_status, distinct from file_status", () => {
  const acc = buildCommitteeTaskPersistRow(
    enrichCommitteeTasks([task({ task_type: "management_attestation", status: "accepted" })], OMNICARE_INPUT)[0],
    NOW,
  );
  assert.equal(acc.resolved_status, "accepted");
  assert.equal(acc.file_status, "needs_review"); // file-derived status preserved independently
});

// ── bucket helper purity ──────────────────────────────────────────────────────

test("[buckets] checklist is bucketed by item status; empty checklist falls back to the task label", () => {
  const fromChecklist = deriveTaskItemBuckets({
    checklist: [
      { label: "A", status: "collected", collect_from: "x", linked_evidence: [], acceptable_evidence: [], linked_sections: [] },
      { label: "B", status: "missing", collect_from: "x", linked_evidence: [], acceptable_evidence: [], linked_sections: [] },
      { label: "C", status: "needs_review", collect_from: "x", linked_evidence: [], acceptable_evidence: [], linked_sections: [] },
    ],
  });
  assert.deepEqual(fromChecklist.collected_items, ["A"]);
  assert.deepEqual(fromChecklist.missing_items, ["B"]);
  assert.deepEqual(fromChecklist.needs_review_items, ["C"]);

  const fromLabel = deriveTaskItemBuckets({ title: "Solo task", evidence_status: "collected" });
  assert.deepEqual(fromLabel.collected_items, ["Solo task"]);
});
