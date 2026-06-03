import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

/**
 * SPEC-BIE-COMMITTEE-EVIDENCE-COLLECTION-FROM-BLOCKERS-1
 * Strengthens committee evidence tasks by linking them to the actual loan file
 * and deriving a real status (missing/collected/needs_review), plus the
 * evidence-coverage checklist. Pure module — unit tested directly.
 */

mockServerOnly();
const require_ = createRequire(import.meta.url);
const { enrichCommitteeTasks, buildCoverageChecklist } =
  require_("@/lib/research/committeeEvidenceLinkage") as typeof import("@/lib/research/committeeEvidenceLinkage");

type Task = import("@/lib/research/committeeEvidenceTasks").CommitteeEvidenceTask;

function task(over: Partial<Task>): Task {
  return { blocker_id: "b1", task_type: "manual_review", status: "pending", ...over } as Task;
}

// OmniCare-like file context: rich loan file, weak public web.
const OMNICARE_INPUT = {
  evidenceRows: [
    { id: "e1", thread_origin: "competitive", claim: "Competes with X", source_uris: ["https://x.com"] },
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

// ── coverage checklist: file re-linking flips gate "missing" → collected ──────

test("[coverage] DSCR + financials + collateral on file → collected, loan request missing", () => {
  const t = enrichCommitteeTasks(
    [task({ task_type: "financial_file", blocker_type: "evidence_coverage" })],
    OMNICARE_INPUT,
  )[0];
  assert.ok(t.checklist);
  const byLabel = Object.fromEntries(t.checklist!.map((c) => [c.label, c.status]));
  assert.equal(byLabel["DSCR"], "collected");
  assert.equal(byLabel["Financial statements / tax returns"], "collected");
  assert.equal(byLabel["Products / services"], "collected");
  assert.equal(byLabel["Collateral records"], "collected"); // AR aging / ELIGIBLE_AR
  assert.equal(byLabel["Loan request / use of proceeds"], "missing");
  assert.equal(byLabel["Management publicly verified"], "needs_review");
  assert.equal(byLabel["Primary/institutional sources"], "missing");
});

test("[coverage] checklist links DSCR to a financial fact", () => {
  const checklist = buildCoverageChecklist({
    // minimal context shape used by buildCoverageChecklist
    hasProducts: false,
    hasDscr: true,
    hasCustomerConcentration: false,
    hasRevenue: true,
    hasArSupport: false,
    financialDocs: [],
    collateralDocs: [],
    primarySources: [],
    managementProfiles: [],
    financialFacts: [{ fact_key: "DSCR" }],
  } as any);
  const dscr = checklist.find((c) => c.label === "DSCR")!;
  assert.equal(dscr.status, "collected");
  assert.ok(dscr.linked_evidence.some((l) => l.kind === "financial_fact" && l.label === "DSCR"));
});

// ── per-task status derivation ───────────────────────────────────────────────

test("[website] domain-matched source on file → collected", () => {
  const t = enrichCommitteeTasks(
    [task({ task_type: "borrower_website_snapshot", target_url: "www.omnicare365.com" })],
    { ...OMNICARE_INPUT, evidenceRows: [{ id: "w", source_types: ["borrower_official_website"], source_uris: ["https://www.omnicare365.com"], claim: "home" }] },
  )[0];
  assert.equal(t.evidence_status, "collected");
  assert.equal(t.resolved_status, "collected");
  assert.deepEqual(t.linked_sections, ["Borrower Profile", "Entity Identification"]);
});

test("[website] no captured source → missing", () => {
  const t = enrichCommitteeTasks([task({ task_type: "borrower_website_snapshot" })], { ...OMNICARE_INPUT, evidenceRows: [] })[0];
  assert.equal(t.evidence_status, "missing");
});

test("[management] profile on file → needs_review (not missing)", () => {
  const t = enrichCommitteeTasks([task({ task_type: "management_attestation" })], OMNICARE_INPUT)[0];
  assert.equal(t.evidence_status, "needs_review");
  assert.ok(t.linked_evidence!.some((l) => l.kind === "management_profile"));
});

test("[adverse] no screen on file → missing", () => {
  const t = enrichCommitteeTasks([task({ task_type: "public_adverse_screen" })], OMNICARE_INPUT)[0];
  assert.equal(t.evidence_status, "missing");
});

test("[competitor] named but unsourced → needs_review", () => {
  const t = enrichCommitteeTasks(
    [task({ task_type: "competitive_source" })],
    { ...OMNICARE_INPUT, evidenceRows: [{ id: "c", thread_origin: "competitive", claim: "Competes with X" }] },
  )[0];
  assert.equal(t.evidence_status, "needs_review");
});

test("[scale] contradiction → never auto-clears, links revenue/AR facts, needs_review", () => {
  const t = enrichCommitteeTasks(
    [task({ task_type: "manual_review", blocker_type: "contradiction_gap", title: "Contradiction unresolved: scale plausibility", blocker_id: "scale_plausibility" })],
    OMNICARE_INPUT,
  )[0];
  assert.equal(t.auto_clear_forbidden, true);
  assert.equal(t.evidence_status, "needs_review");
  assert.ok(t.linked_evidence!.some((l) => l.label === "TOTAL_REVENUE" || l.label === "DSCR"));
});

test("[scale] contradiction routed as financial_file → never auto-clears, capped at needs_review", () => {
  const t = enrichCommitteeTasks(
    [task({ task_type: "financial_file", blocker_type: "contradiction_gap", blocker_id: "scale_plausibility", title: "Contradiction unresolved: scale plausibility" })],
    OMNICARE_INPUT,
  )[0];
  assert.equal(t.auto_clear_forbidden, true);
  assert.ok(t.checklist);
  // Even if file evidence is strong, a contradiction never reads as plain "collected".
  assert.notEqual(t.resolved_status, "collected");
});

// ── composition: banker action wins over file-derived status ─────────────────

test("[compose] persisted accepted/rejected override file-derived status", () => {
  const acc = enrichCommitteeTasks([task({ task_type: "management_attestation", status: "accepted" })], OMNICARE_INPUT)[0];
  assert.equal(acc.resolved_status, "accepted");
  const rej = enrichCommitteeTasks([task({ task_type: "financial_file", status: "rejected" })], OMNICARE_INPUT)[0];
  assert.equal(rej.resolved_status, "rejected");
});

test("[compose] auto-collected (persisted collected) stays collected", () => {
  const t = enrichCommitteeTasks([task({ task_type: "borrower_website_snapshot", status: "collected" })], { ...OMNICARE_INPUT, evidenceRows: [] })[0];
  assert.equal(t.resolved_status, "collected");
});

test("[purity] input tasks are not mutated", () => {
  const input = [task({ task_type: "financial_file", blocker_type: "evidence_coverage" })];
  const out = enrichCommitteeTasks(input, OMNICARE_INPUT);
  assert.equal((input[0] as any).checklist, undefined);
  assert.ok(out[0].checklist);
});
