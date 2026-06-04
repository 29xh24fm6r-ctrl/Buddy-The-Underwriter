import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCommitteeBlockerImpactPreview,
  type ImpactPreviewInput,
} from "@/lib/research/committeeBlockerImpactPreview";
import {
  evaluateCommitteeReadinessTransition,
  buildCommitteeReadinessSection,
  applyCommitteeReadinessTransition,
} from "@/lib/research/committeeReadinessTransition";
import type { CommitteeBlockerResolution } from "@/lib/research/committeeBlockerResolution";
import type { CommitteeEvidenceTask } from "@/lib/research/committeeEvidenceTasks";

/**
 * SPEC-BIE-COMMITTEE-READINESS-FINALIZATION-MEGA-1
 * Pure impact-preview + transition-guard. Read-only; no approval, no mutation.
 */

const NOW = "2026-06-04T18:00:00.000Z";

function task(over: Partial<CommitteeEvidenceTask>): CommitteeEvidenceTask {
  return { id: "t", blocker_id: "b", task_type: "manual_review", status: "pending", review_status: "unreviewed", ...over } as CommitteeEvidenceTask;
}

function res(over: Partial<CommitteeBlockerResolution>): CommitteeBlockerResolution {
  return {
    blocker_id: over.blocker_id ?? "b",
    title: over.title ?? "t",
    blocker_type: over.blocker_type ?? "other",
    severity: "committee_blocker",
    current_status: "partial",
    why_it_blocks_committee: "",
    existing_supporting_evidence: [],
    missing_evidence: over.missing_evidence ?? ["x"],
    recommended_actions: [],
    acceptable_evidence_examples: [],
    can_be_banker_certified_for_preliminary: true,
    requires_public_or_attested_evidence_for_committee: true,
    ...over,
  };
}

const GATE = {
  trust_grade: "preliminary",
  gate_passed: true,
  preliminary_eligible: true,
  committee_eligible: false,
  committee_blockers: ["a", "b", "c"],
};

function preview(resolutions: CommitteeBlockerResolution[], tasks: CommitteeEvidenceTask[] = []): ReturnType<typeof buildCommitteeBlockerImpactPreview> {
  const input: ImpactPreviewInput = {
    missionId: "m", dealId: "d", generatedAt: NOW, gate: GATE,
    resolutions, requirementsPlan: null, tasks,
  };
  return buildCommitteeBlockerImpactPreview(input);
}

// ── impact preview ─────────────────────────────────────────────────────────--

test("[impact] website committee-grade reduces source-quality, does not resolve all", () => {
  const p = preview([
    res({
      blocker_id: "src", blocker_type: "source_quality", title: "Stronger public/institutional sources required",
      evidence_tasks: [
        task({ task_type: "borrower_website_snapshot", review_status: "committee_grade", committee_grade_accepted: true, title: "Website" }),
        task({ task_type: "sos_business_registry", review_status: "unreviewed", title: "SOS" }),
      ],
    }),
  ]);
  const b = p.blocker_impacts[0];
  assert.equal(b.impact_status, "would_reduce");
  assert.ok(b.evidence_applied.some((e) => e.committee_grade_accepted));
});

test("[impact] SOS committee-grade resolves entity public verification", () => {
  const p = preview([
    res({
      blocker_id: "ent", blocker_type: "public_entity_verification", title: "Public/attested entity verification",
      evidence_tasks: [
        task({ task_type: "borrower_website_snapshot", review_status: "committee_grade", committee_grade_accepted: true, title: "Website" }),
        task({ task_type: "sos_business_registry", review_status: "committee_grade", committee_grade_accepted: true, title: "SOS" }),
      ],
    }),
  ]);
  assert.equal(p.blocker_impacts[0].impact_status, "would_resolve");
});

test("[impact] management accepted (not committee-grade) → would_reduce, committee still open", () => {
  const p = preview([
    res({
      blocker_id: "mgmt", blocker_type: "management_verification", title: "Management verification",
      evidence_tasks: [task({ task_type: "management_attestation", review_status: "accepted", committee_grade_accepted: false, title: "Mgmt" })],
    }),
  ]);
  assert.equal(p.blocker_impacts[0].impact_status, "would_reduce");
});

test("[impact] adverse screen unreviewed → still_blocked", () => {
  const p = preview([
    res({ blocker_id: "lit", blocker_type: "adverse_screen", title: "Litigation",
      evidence_tasks: [task({ task_type: "public_adverse_screen", review_status: "unreviewed", title: "Adverse" })] }),
  ]);
  assert.equal(p.blocker_impacts[0].impact_status, "still_blocked");
});

test("[impact] rejected/weak/wrong-entity evidence never resolves", () => {
  for (const rs of ["rejected", "weak_source", "wrong_entity"]) {
    const p = preview([
      res({ blocker_id: "ind", blocker_type: "section_source_gap", title: "Section needs committee-grade sources: Industry Overview",
        evidence_tasks: [task({ task_type: "industry_market_source", review_status: rs, title: "Industry" })] }),
    ]);
    assert.equal(p.blocker_impacts[0].impact_status, "still_blocked", `review ${rs}`);
  }
});

test("[impact] scale_plausibility never auto-resolves (unsafe + auto_clear_forbidden)", () => {
  const p = preview([
    res({ blocker_id: "scale_plausibility", blocker_type: "contradiction_gap", title: "Contradiction unresolved: scale plausibility",
      evidence_tasks: [task({ task_type: "financial_file", blocker_type: "contradiction_gap", review_status: "accepted", committee_grade_accepted: false, auto_clear_forbidden: true, title: "FF" })] }),
  ]);
  const b = p.blocker_impacts[0];
  assert.equal(b.blocker_type, "scale_plausibility");
  assert.equal(b.impact_status, "unsafe_to_auto_resolve");
  assert.equal(b.auto_clear_forbidden, true);
  assert.equal(b.requires_human_conclusion, true);
});

test("[impact] committee_ready_if_applied false while any hard blocker remains", () => {
  const p = preview([
    res({ blocker_id: "ent", blocker_type: "public_entity_verification", title: "entity",
      evidence_tasks: [task({ task_type: "sos_business_registry", review_status: "committee_grade", committee_grade_accepted: true })] }),
    res({ blocker_id: "scale_plausibility", blocker_type: "contradiction_gap", title: "Contradiction unresolved: scale plausibility",
      evidence_tasks: [task({ task_type: "financial_file", blocker_type: "contradiction_gap", review_status: "accepted", auto_clear_forbidden: true })] }),
  ]);
  assert.equal(p.committee_ready_if_applied, false);
  assert.ok(p.committee_ready_blocked_by.length > 0);
});

test("[impact] read-only: does not mutate the input resolutions/tasks", () => {
  const t = task({ task_type: "borrower_website_snapshot", review_status: "committee_grade", committee_grade_accepted: true });
  const r = res({ blocker_id: "src", blocker_type: "source_quality", evidence_tasks: [t] });
  const snapshot = JSON.stringify({ r, t });
  preview([r], [t]);
  assert.equal(JSON.stringify({ r, t }), snapshot, "inputs must be untouched");
});

// ── transition guard ──────────────────────────────────────────────────────--

test("[transition] all blockers committee-grade → eligible true, proposed committee_grade", () => {
  const p = preview([
    res({ blocker_id: "ent", blocker_type: "public_entity_verification", title: "entity",
      evidence_tasks: [task({ task_type: "sos_business_registry", review_status: "committee_grade", committee_grade_accepted: true })] }),
    res({ blocker_id: "lit", blocker_type: "adverse_screen", title: "adverse",
      evidence_tasks: [task({ task_type: "public_adverse_screen", review_status: "accepted" })] }),
  ]);
  const tr = evaluateCommitteeReadinessTransition({ preview: p, gate: GATE, tasks: [] });
  assert.equal(tr.eligible_for_committee_transition, true);
  assert.equal(tr.proposed_trust_grade, "committee_grade");
  assert.match(tr.explanation, /after operator review/i);
  assert.doesNotMatch(tr.explanation, /\bapproved\b/i);
});

test("[transition] one still-blocked blocker → not eligible", () => {
  const p = preview([
    res({ blocker_id: "ent", blocker_type: "public_entity_verification", title: "entity",
      evidence_tasks: [task({ task_type: "sos_business_registry", review_status: "committee_grade", committee_grade_accepted: true })] }),
    res({ blocker_id: "lit", blocker_type: "adverse_screen", title: "adverse",
      evidence_tasks: [task({ task_type: "public_adverse_screen", review_status: "unreviewed" })] }),
  ]);
  const tr = evaluateCommitteeReadinessTransition({ preview: p, gate: GATE, tasks: [] });
  assert.equal(tr.eligible_for_committee_transition, false);
  assert.ok(tr.remaining_blockers.length >= 1);
});

test("[transition] scale plausibility without analyst conclusion → not eligible", () => {
  const p = preview([
    res({ blocker_id: "scale_plausibility", blocker_type: "contradiction_gap", title: "Contradiction unresolved: scale plausibility",
      evidence_tasks: [task({ task_type: "financial_file", blocker_type: "contradiction_gap", review_status: "accepted", auto_clear_forbidden: true })] }),
  ]);
  const tr = evaluateCommitteeReadinessTransition({ preview: p, gate: GATE, tasks: [] });
  assert.equal(tr.eligible_for_committee_transition, false);
  assert.ok(tr.hard_blockers.length >= 1);
});

test("[transition] wrong-entity is an absolute hard stop", () => {
  const p = preview(
    [res({ blocker_id: "ent", blocker_type: "public_entity_verification", title: "entity",
      evidence_tasks: [task({ task_type: "sos_business_registry", review_status: "wrong_entity" })] })],
    [task({ task_type: "sos_business_registry", review_status: "wrong_entity" })],
  );
  const tr = evaluateCommitteeReadinessTransition({ preview: p, gate: GATE, tasks: [task({ review_status: "wrong_entity" })] });
  assert.equal(tr.eligible_for_committee_transition, false);
  assert.ok(tr.required_operator_actions.some((a) => /wrong\/conflicting entity/i.test(a)));
});

test("[transition] preview/transition never mutate the gate object", () => {
  const gate = { ...GATE };
  const snap = JSON.stringify(gate);
  const p = preview([res({ blocker_id: "x", blocker_type: "adverse_screen", title: "adverse", evidence_tasks: [task({ task_type: "public_adverse_screen" })] })]);
  evaluateCommitteeReadinessTransition({ preview: p, gate, tasks: [] });
  assert.equal(JSON.stringify(gate), snap);
  assert.equal(gate.committee_eligible, false); // unchanged
});

// ── readiness section ─────────────────────────────────────────────────────--

test("[section] accepted evidence listed; unreviewed not; preliminary/committee status correct", () => {
  const tasks = [
    task({ id: "w", task_type: "borrower_website_snapshot", title: "Website", review_status: "committee_grade", committee_grade_accepted: true, linked_sections: ["Borrower Profile"] }),
    task({ id: "u", task_type: "sos_business_registry", title: "SOS", review_status: "unreviewed" }),
  ];
  const p = preview([res({ blocker_id: "src", blocker_type: "source_quality", title: "sources", evidence_tasks: tasks })], tasks);
  const tr = evaluateCommitteeReadinessTransition({ preview: p, gate: GATE, tasks });
  const section = buildCommitteeReadinessSection(p, tr, tasks);
  assert.equal(section.preliminary_status.ready, true);
  assert.equal(section.committee_status.ready, false);
  assert.ok(section.accepted_evidence.some((e) => e.title === "Website" && e.committee_grade_accepted));
  assert.equal(section.accepted_evidence.some((e) => e.title === "SOS"), false); // unreviewed excluded
});

// ── Phase 4 stub ──────────────────────────────────────────────────────────--

test("[phase4] applyCommitteeReadinessTransition is disabled and throws", () => {
  assert.throws(() => applyCommitteeReadinessTransition(), /disabled/i);
  assert.throws(() => applyCommitteeReadinessTransition({ enableExplicitlyForTesting: true }), /disabled/i);
});
