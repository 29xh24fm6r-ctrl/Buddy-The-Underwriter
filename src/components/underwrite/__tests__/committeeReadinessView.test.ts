/**
 * SPEC-BIE-COMMITTEE-READINESS-UX-SIMPLIFICATION-1
 *
 * The committee readiness section is re-projected into a banker-facing view:
 * 5 human-readable groups, 3 counters, one prioritized next action, plain-English
 * scale-plausibility, and machine fields confined to an audit projection.
 *
 * These tests pin: plain-English groups, no machine vocabulary in the default
 * view, audit still exposes technical fields, preliminary/committee status
 * correctness, deterministic next-best-action, scale plausibility framing, and
 * that the projection is pure (no gate mutation, no DB).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  buildCommitteeReadinessView,
  defaultViewText,
} from "../committeeReadinessView";
import { EMPTY_RESEARCH_GATE_SNAPSHOT, type ResearchGateSnapshot } from "../researchGateTypes";
import type { CommitteeBlockerResolution } from "@/lib/research/committeeBlockerResolution";
import type { CommitteeEvidenceTask } from "@/lib/research/committeeEvidenceTasks";
import type { CommitteeReadinessSection } from "@/lib/research/committeeReadinessTransition";

// Machine/internal words that must never appear in the default banker view.
const MACHINE_TERMS = [
  "source_quality",
  "evidence_coverage",
  "resolved_status",
  "file_status",
  "committee_grade_accepted",
  "auto_clear_forbidden",
  "task_type",
  "blocker_type",
  "section_source_gap",
  "contradiction_gap",
];

function task(over: Partial<CommitteeEvidenceTask>): CommitteeEvidenceTask {
  return {
    id: "task-" + (over.task_type ?? "x"),
    blocker_id: "b",
    task_type: "manual_review",
    status: "pending",
    ...over,
  } as CommitteeEvidenceTask;
}

function mkBlocker(over: Partial<CommitteeBlockerResolution>): CommitteeBlockerResolution {
  return {
    blocker_id: "blk",
    title: "Blocker",
    blocker_type: "other",
    severity: "committee_blocker",
    current_status: "missing",
    why_it_blocks_committee: "why",
    existing_supporting_evidence: [],
    missing_evidence: [],
    recommended_actions: [],
    acceptable_evidence_examples: [],
    can_be_banker_certified_for_preliminary: true,
    requires_public_or_attested_evidence_for_committee: true,
    ...over,
  };
}

// OmniCare-shaped fixture: preliminary cleared, committee blocked, 8 blockers
// across all 5 groups (entity, management, financial, industry, risk).
function omniCareBlockers(): CommitteeBlockerResolution[] {
  return [
    mkBlocker({
      blocker_id: "entity_verification",
      title: "Public/attested entity verification",
      blocker_type: "public_entity_verification",
      current_status: "present_but_not_committee_grade",
      missing_evidence: ["Public/official entity record OR attested entity document"],
      existing_supporting_evidence: [{ section: "Borrower Profile", claim_preview: "OmniCare LLC" }],
      evidence_tasks: [
        task({ task_type: "borrower_website_snapshot", title: "Borrower website snapshot", status: "collected", resolved_status: "collected" }),
        task({ task_type: "sos_business_registry", title: "Secretary of State record", status: "collected", resolved_status: "needs_review" }),
      ],
    }),
    mkBlocker({
      blocker_id: "stronger_sources",
      title: "Stronger public/institutional sources required",
      blocker_type: "source_quality",
      current_status: "present_but_not_committee_grade",
      missing_evidence: ["At least one primary/institutional public source"],
    }),
    mkBlocker({
      blocker_id: "management_adverse",
      title: "Public/attested management verification + adverse screen",
      blocker_type: "management_verification",
      current_status: "present_but_not_committee_grade",
      missing_evidence: ["Public/official confirmation of management role", "Completed public adverse screen result"],
      evidence_tasks: [
        task({ task_type: "management_attestation", title: "Management profile", status: "collected", resolved_status: "collected" }),
      ],
    }),
    mkBlocker({
      blocker_id: "evidence_coverage",
      title: "Evidence coverage below committee threshold",
      blocker_type: "evidence_coverage",
      current_status: "partial",
      missing_evidence: ["Loan request / use of proceeds", "Primary/institutional public source"],
      existing_supporting_evidence: [
        { section: "Financial Analysis", claim_preview: "DSCR 1.4x" },
        { section: "Collateral", claim_preview: "appraisal on file" },
      ],
    }),
    mkBlocker({
      blocker_id: "industry_source",
      title: "Section needs committee-grade sources: Industry Overview",
      blocker_type: "section_source_gap",
      current_status: "missing",
      missing_evidence: ["Committee-grade source for Industry Overview"],
    }),
    mkBlocker({
      blocker_id: "market_source",
      title: "Section needs committee-grade sources: Market Intelligence",
      blocker_type: "section_source_gap",
      current_status: "present_but_not_committee_grade",
      missing_evidence: ["Committee-grade source for Market Intelligence"],
    }),
    mkBlocker({
      blocker_id: "competitive_source",
      title: "Section needs committee-grade sources: Competitive Landscape",
      blocker_type: "section_source_gap",
      current_status: "present_but_not_committee_grade",
      missing_evidence: ["Committee-grade source for Competitive Landscape"],
    }),
    mkBlocker({
      blocker_id: "scale_plausibility",
      title: "Contradiction unresolved: scale plausibility",
      blocker_type: "contradiction_gap",
      current_status: "missing",
      missing_evidence: ['Evidence that resolves the "scale_plausibility" check'],
    }),
  ];
}

function omniCareSection(): CommitteeReadinessSection {
  return {
    preliminary_status: { ready: true, basis: "Preliminary cleared (file / banker-certified evidence)." },
    committee_status: { ready: false, eligible_for_transition: false, trust_grade: "banker_certified_preliminary", remaining_blocker_count: 8 },
    accepted_evidence: [],
    resolved_or_reduced_blockers: [],
    remaining_blockers: [
      {
        blocker_id: "scale_plausibility",
        blocker_label: "Contradiction unresolved: scale plausibility",
        blocker_type: "scale_plausibility",
        current_status: "blocking",
        impact_status: "unsafe_to_auto_resolve",
        evidence_applied: [],
        why: "Scale plausibility never auto-clears.",
        remaining_requirements: ["Explicit analyst scale-plausibility conclusion"],
        requires_human_conclusion: true,
        auto_clear_forbidden: true,
      },
    ],
    required_next_actions: ["Operator review required before committee readiness transition."],
    limitations: ["Read-only preview."],
  };
}

function omniCareSnapshot(over: Partial<ResearchGateSnapshot> = {}): ResearchGateSnapshot {
  return {
    ...EMPTY_RESEARCH_GATE_SNAPSHOT,
    gatePassed: true,
    preliminaryEligible: true,
    committeeEligible: false,
    preliminaryBasis: "banker_certified_private_company",
    committeeBlockerResolutions: omniCareBlockers(),
    committeeReadinessSection: omniCareSection(),
    ...over,
  };
}

describe("buildCommitteeReadinessView — summary", () => {
  it("preliminary clear, committee not ready yet (status still correct)", () => {
    const view = buildCommitteeReadinessView(omniCareSnapshot())!;
    assert.ok(view);
    assert.equal(view.summary.preliminaryStatusLabel, "Preliminary is clear");
    assert.equal(view.summary.committeeStatusLabel, "Committee is not ready yet");
    assert.equal(view.summary.preliminaryClear, true);
    assert.equal(view.summary.committeeReady, false);
    assert.match(view.summary.subcopy, /preliminary underwriting/i);
  });

  it("3 counters reflect blocker-level status", () => {
    const { counters } = buildCommitteeReadinessView(omniCareSnapshot())!.summary;
    // 0 complete; missing = evidence_coverage(partial) + industry(missing) = 2;
    // needs review = entity, sources, management, market, competitive, scale(analyst) = 6.
    assert.equal(counters.ready, 0);
    assert.equal(counters.missing, 2);
    assert.equal(counters.needsReview, 6);
    assert.equal(
      counters.ready + counters.needsReview + counters.missing,
      8,
      "every blocker is counted exactly once",
    );
  });

  it("returns null when there are no blocker resolutions", () => {
    assert.equal(buildCommitteeReadinessView(omniCareSnapshot({ committeeBlockerResolutions: [] })), null);
  });
});

describe("buildCommitteeReadinessView — 5 plain-English groups", () => {
  it("renders all 5 human-readable groups with expected statuses", () => {
    const view = buildCommitteeReadinessView(omniCareSnapshot())!;
    const byId = Object.fromEntries(view.groups.map((g) => [g.id, g]));
    assert.deepEqual(
      view.groups.map((g) => g.id),
      ["entity", "management", "financial", "industry", "risk"],
    );
    assert.equal(byId.entity.title, "Entity & public record");
    assert.equal(byId.entity.status, "Needs review");
    assert.equal(byId.management.title, "Management & ownership");
    assert.equal(byId.management.status, "Needs review");
    assert.equal(byId.financial.title, "Financial & loan support");
    assert.equal(byId.financial.status, "Missing");
    assert.equal(byId.industry.title, "Industry, market & competition");
    assert.equal(byId.industry.status, "Missing");
    assert.equal(byId.risk.title, "Risk & red flags");
    assert.equal(byId.risk.status, "Needs analyst conclusion");
  });

  it("groups carry plain-English explanations and evidence lists", () => {
    const view = buildCommitteeReadinessView(omniCareSnapshot())!;
    const byId = Object.fromEntries(view.groups.map((g) => [g.id, g]));
    assert.match(byId.entity.explanation, /reliable public or official records/i);
    // Financial: items already on file are surfaced even though status is Missing.
    assert.ok(byId.financial.alreadyOnFile.some((s) => /DSCR/i.test(s) || /Financial Analysis/i.test(s)));
    assert.ok(byId.financial.stillNeeded.some((s) => /loan request/i.test(s)));
    // Each unresolved group has a concrete next action.
    for (const g of view.groups) {
      if (g.status !== "Complete") assert.ok(g.nextAction && g.nextAction.length > 0);
    }
  });
});

describe("buildCommitteeReadinessView — next best action is deterministic", () => {
  it("OmniCare leads with the adverse-record screen", () => {
    const a = buildCommitteeReadinessView(omniCareSnapshot())!.summary.nextBestAction;
    const b = buildCommitteeReadinessView(omniCareSnapshot())!.summary.nextBestAction;
    assert.equal(a, "Complete the adverse-record screen.");
    assert.equal(a, b, "same input → same prioritized action");
  });

  it("wrong/conflicting entity outranks everything", () => {
    const blockers = omniCareBlockers();
    blockers.unshift(
      mkBlocker({
        blocker_id: "wrong_entity",
        title: "Resolve wrong/conflicting public entity",
        blocker_type: "other",
        current_status: "missing",
      }),
    );
    const view = buildCommitteeReadinessView(omniCareSnapshot({ committeeBlockerResolutions: blockers }))!;
    assert.match(view.summary.nextBestAction ?? "", /wrong or conflicting borrower entity/i);
  });
});

describe("buildCommitteeReadinessView — scale plausibility framing", () => {
  it("rendered as an analyst conclusion, not a raw contradiction", () => {
    const view = buildCommitteeReadinessView(omniCareSnapshot())!;
    assert.ok(view.scalePlausibility, "scale plausibility callout present");
    assert.equal(view.scalePlausibility!.label, "Scale plausibility needs analyst conclusion");
    assert.match(view.scalePlausibility!.explanation, /analyst to confirm/i);
    assert.match(view.scalePlausibility!.nextAction, /analyst conclusion/i);
    // Never the raw machine word.
    assert.doesNotMatch(view.scalePlausibility!.label, /contradiction_gap|contradiction/i);
  });
});

describe("buildCommitteeReadinessView — machine vocabulary is hidden by default", () => {
  it("no internal terms appear in the default view", () => {
    const text = defaultViewText(buildCommitteeReadinessView(omniCareSnapshot())!).toLowerCase();
    for (const term of MACHINE_TERMS) {
      assert.ok(!text.includes(term), `default view leaked machine term: ${term}`);
    }
    // Specifically does not lead with implementation jargon.
    for (const lead of ["source_quality", "evidence_coverage", "section_source_gap", "contradiction_gap", "auto_clear_forbidden"]) {
      assert.ok(!text.includes(lead));
    }
  });
});

describe("buildCommitteeReadinessView — audit projection keeps technical fields", () => {
  it("audit rows expose the machine fields", () => {
    const view = buildCommitteeReadinessView(omniCareSnapshot())!;
    assert.equal(view.audit.length, 8);
    const entity = view.audit.find((r) => r.blocker_id === "entity_verification")!;
    assert.equal(entity.blocker_type, "public_entity_verification");
    assert.equal(entity.resolved_status, "present_but_not_committee_grade");
    // Task-level technical fields survive in audit.
    const sos = entity.tasks.find((t) => t.task_type === "sos_business_registry")!;
    assert.equal(sos.resolved_status, "needs_review");
    assert.equal(typeof sos.committee_grade_accepted, "boolean");
    assert.equal(typeof sos.auto_clear_forbidden, "boolean");
    // Serialized audit still contains the raw vocabulary the default view hides.
    const auditText = JSON.stringify(view.audit);
    assert.ok(/blocker_type/.test(auditText));
    assert.ok(/resolved_status/.test(auditText));
    assert.ok(/committee_grade_accepted/.test(auditText));
  });
});

describe("buildCommitteeReadinessView — captured-source artifacts (SPEC-…-LOAN-FILE-ARTIFACT-1)", () => {
  function withArtifacts(): ResearchGateSnapshot {
    const blockers = omniCareBlockers();
    const entity = blockers.find((b) => b.blocker_id === "entity_verification")!;
    entity.evidence_tasks = [
      task({ task_type: "borrower_website_snapshot", title: "Borrower website snapshot", status: "collected", resolved_status: "collected", artifact_view_url: "/api/deals/dc52c626/research/source-artifact?artifact_id=art-web" }),
      task({ task_type: "sos_business_registry", title: "Secretary of State record", status: "collected", resolved_status: "needs_review", artifact_view_url: "/api/deals/dc52c626/research/source-artifact?artifact_id=art-sos" }),
    ];
    return omniCareSnapshot({ committeeBlockerResolutions: blockers });
  }

  it("entity group exposes View-captured-source links for website + SOS in the default view", () => {
    const view = buildCommitteeReadinessView(withArtifacts())!;
    const entity = view.groups.find((g) => g.id === "entity")!;
    assert.equal(entity.capturedSources.length, 2);
    const urls = entity.capturedSources.map((s) => s.url);
    assert.ok(urls.some((u) => u.includes("art-web")));
    assert.ok(urls.some((u) => u.includes("art-sos")));
    assert.ok(entity.capturedSources.some((s) => /website/i.test(s.label)));
    assert.ok(entity.capturedSources.some((s) => /secretary of state/i.test(s.label)));
  });

  it("artifact links also appear in the audit projection per task", () => {
    const view = buildCommitteeReadinessView(withArtifacts())!;
    const entity = view.audit.find((r) => r.blocker_id === "entity_verification")!;
    const web = entity.tasks.find((t) => t.task_type === "borrower_website_snapshot")!;
    assert.match(web.artifact_view_url ?? "", /art-web/);
  });

  it("captured-source labels do not leak machine vocabulary into the default view", () => {
    const text = defaultViewText(buildCommitteeReadinessView(withArtifacts())!).toLowerCase();
    for (const term of MACHINE_TERMS) assert.ok(!text.includes(term), `leaked: ${term}`);
  });

  it("no artifacts → capturedSources is empty (no link shown)", () => {
    const view = buildCommitteeReadinessView(omniCareSnapshot())!;
    for (const g of view.groups) assert.deepEqual(g.capturedSources, []);
  });
});

describe("buildCommitteeReadinessView — pure projection (no gate/DB changes)", () => {
  it("does not mutate the input snapshot", () => {
    const snap = omniCareSnapshot();
    const before = JSON.stringify(snap);
    buildCommitteeReadinessView(snap);
    assert.equal(JSON.stringify(snap), before);
  });

  it("the view module performs no I/O and no gate mutation", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "..", "committeeReadinessView.ts"),
      "utf8",
    );
    assert.ok(!/server-only/.test(src), "must not import server-only");
    assert.ok(!/from\s+["']@\/lib\/(supabase|db)/.test(src), "must not import supabase/db");
    assert.ok(!/supabaseAdmin|createClient|\.from\(|upsert|insert\(|update\(/.test(src), "must not touch the database");
  });
});
