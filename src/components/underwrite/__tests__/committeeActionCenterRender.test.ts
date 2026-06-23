import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CommitteeReadinessPanel, CommitteeTaskActionCard } from "../ResearchGateActionPanel";
import { buildCommitteeReadinessView } from "../committeeReadinessView";
import { EMPTY_RESEARCH_GATE_SNAPSHOT, type ResearchGateSnapshot } from "../researchGateTypes";

/**
 * SPEC-COMMITTEE-ACTION-CENTER-FINAL-WORKFLOW-CORRECTION-1
 *
 * RENDER tests (not source-regex): the visible Next Actions section must contain
 * actual executable buttons, and Evidence Status must NOT be an action surface.
 */

function blocker(over: Record<string, unknown>): any {
  return {
    blocker_id: "b",
    blocker_type: "other",
    title: "Blocker",
    current_status: "missing",
    why_it_blocks_committee: "Committee needs this.",
    missing_evidence: [],
    existing_supporting_evidence: [],
    recommended_actions: [],
    evidence_tasks: [],
    can_be_banker_certified_for_preliminary: false,
    requires_public_or_attested_evidence_for_committee: true,
    ...over,
  };
}

function task(over: Record<string, unknown>): any {
  return { id: "t", blocker_id: "b", task_type: "manual_review", status: "pending", resolved_status: "missing", review_status: "unreviewed", ...over };
}

function snapshot(): ResearchGateSnapshot {
  return {
    ...EMPTY_RESEARCH_GATE_SNAPSHOT,
    gatePassed: true,
    committeeEligible: false,
    committeeBlockerResolutions: [
      blocker({
        blocker_id: "adverse",
        blocker_type: "adverse_screen",
        title: "Public adverse screen",
        evidence_tasks: [task({ id: "adv", blocker_id: "adverse", task_type: "public_adverse_screen", title: "Adverse screen" })],
      }),
      blocker({
        blocker_id: "scale",
        blocker_type: "contradiction_gap",
        title: "Contradiction unresolved: scale plausibility",
        evidence_tasks: [task({ id: "scale", blocker_id: "scale", task_type: "scale_plausibility", title: "Scale plausibility", auto_clear_forbidden: true })],
      }),
      blocker({
        blocker_id: "entity",
        blocker_type: "public_entity_verification",
        title: "Public/attested entity verification",
        current_status: "present_but_not_committee_grade",
        evidence_tasks: [task({ id: "sos", blocker_id: "entity", task_type: "sos_business_registry", title: "SOS record", resolved_status: "needs_review", official_capture_available: false, official_capture_status: "search_form_only" })],
      }),
    ] as any,
  } as ResearchGateSnapshot;
}

function render(): string {
  return renderToStaticMarkup(
    React.createElement(CommitteeReadinessPanel, {
      snapshot: snapshot(),
      onReviewTask: () => {},
      onAttachSource: () => {},
    }),
  );
}

// Isolate the Next Actions section from the Evidence Status section.
function section(html: string, startId: string, endId: string): string {
  const s = html.indexOf(`data-testid="${startId}"`);
  const e = endId ? html.indexOf(`data-testid="${endId}"`) : html.length;
  assert.ok(s >= 0, `missing section ${startId}`);
  return html.slice(s, e > s ? e : html.length);
}

describe("Committee action center — rendered Next Actions are executable", () => {
  it("the committee-next-actions section renders real action cards with buttons", () => {
    const html = render();
    assert.match(html, /data-testid="committee-next-actions"/);
    const nextActions = section(html, "committee-next-actions", "committee-progress-rail");
    // Real action cards rendered (one per unresolved group).
    assert.match(nextActions, /data-testid="committee-action-card-/);
    // Actual executable <button> elements inside the Next Actions section.
    assert.ok((nextActions.match(/<button/g) ?? []).length >= 2, "expected executable buttons in Next Actions");
  });

  it("the public-records card frames a business question with a No-findings primary button", () => {
    const nextActions = section(render(), "committee-next-actions", "committee-progress-rail");
    assert.match(nextActions, /data-testid="committee-action-primary-risk"/);
    assert.match(nextActions, /Public Records Review/i);
    assert.match(nextActions, /adverse findings/i);
    assert.match(nextActions, /No findings/i);
  });

  it("the business-scale card frames a question with an Enter-conclusion primary button", () => {
    const nextActions = section(render(), "committee-next-actions", "committee-progress-rail");
    assert.match(nextActions, /data-testid="committee-action-primary-scale"/);
    assert.match(nextActions, /Business Scale/i);
    assert.match(nextActions, /Enter conclusion/i);
  });

  it("hero shows 'Not ready' + decisions-required count + a Start-next-decision CTA button", () => {
    const html = render();
    const hero = section(html, "committee-readiness-hero", "committee-next-actions");
    assert.match(hero, /Not ready/i);
    assert.match(hero, /decisions? required/i);
    assert.match(hero, /data-testid="committee-hero-primary"/);
    assert.match(hero, /Start next decision/i);
    assert.match(hero, /<button/);
  });

  it("Evidence Status is read-only — no action primary buttons live there", () => {
    const html = render();
    const evidence = section(html, "committee-progress-rail", "committee-blockers-panel");
    assert.doesNotMatch(evidence, /committee-action-primary-/);
    assert.doesNotMatch(evidence, /committee-action-card-/);
  });

  it("Committee Blockers render once as a read-only summary (reconcile count)", () => {
    const html = render();
    assert.match(html, /data-testid="committee-blockers-panel"/);
    const blockers = section(html, "committee-blockers-panel", "committee-readiness-audit");
    // No executable buttons in the read-only blocker summary.
    assert.doesNotMatch(blockers, /<button/);
  });

  it("each card shows the decision narrative by default (conclusion + recommendation + evidence + satisfies)", () => {
    const nextActions = section(render(), "committee-next-actions", "committee-progress-rail");
    assert.match(nextActions, /data-testid="committee-decision-support-/);
    assert.match(nextActions, /conclusion:/i); // "Buddy's conclusion:" (apostrophe HTML-escaped)
    assert.match(nextActions, /data-testid="committee-recommendation-/);
    assert.match(nextActions, /Confidence:/i);
    assert.match(nextActions, /Evidence used|Key findings|Scale factors/i);
    assert.match(nextActions, /What satisfies this/i);
  });

  it("no internal workflow vocabulary leaks into the Next Actions surface", () => {
    const nextActions = section(render(), "committee-next-actions", "committee-progress-rail");
    // Internal machine terms AND the hyphenated "committee-grade" stay off the
    // default surface. ("attestation" is a legitimate banker evidence term and is
    // allowed in acceptable-evidence copy.)
    for (const term of ["committee_grade", "committee-grade", "auto_clear_forbidden", "review_status", "task_type", "blocker_type", "resolved_status"]) {
      assert.doesNotMatch(nextActions, new RegExp(term, "i"));
    }
  });
});

// SPEC-…-DECISION-INTELLIGENCE-1 (A): opening a card ALWAYS produces a visible
// change — a drawer for attach/conclusion cards, a decision-support panel for
// approve/record cards. Rendered directly with open=true (no click needed).
describe("opening a decision card always changes the UI", () => {
  const cardFor = (groupId: string) =>
    buildCommitteeReadinessView(snapshot())!.actionCards.find((c) => c.groupId === groupId)!;
  const renderCard = (groupId: string, open: boolean) =>
    renderToStaticMarkup(
      React.createElement(CommitteeTaskActionCard, {
        card: cardFor(groupId),
        open,
        onToggle: () => {},
        onReviewTask: () => {},
        onAttachSource: () => {},
      }),
    );

  it("a record/approve card (public records) opens a decision-support panel, not a drawer", () => {
    const opened = renderCard("risk", true);
    assert.match(opened, /data-testid="committee-decision-panel-risk"/);
    assert.match(opened, /review before you decide/i);
    assert.doesNotMatch(renderCard("risk", false), /committee-decision-panel-risk/);
  });

  it("a conclusion card (business scale) opens a drawer", () => {
    const opened = renderCard("scale", true);
    assert.match(opened, /data-testid="committee-action-drawer-scale"/);
    assert.doesNotMatch(renderCard("scale", false), /committee-action-drawer-scale/);
  });
});

// SPEC-…-EVIDENCE-PROMOTION-1 PR-B (L): evidence-class badges + confidence drivers
// render on the card when the classified projection is present.
describe("classified evidence renders class badges + confidence drivers", () => {
  function snapshotWithEvidence(): ResearchGateSnapshot {
    return {
      ...snapshot(),
      committeeDecisionEvidence: {
        privateCompanyEvidenceMode: true,
        scalePlausibilityUnresolved: true,
        scaleFactors: [
          { factor: "Revenue support", status: "Supported", evidenceClass: "file_supported", label: "Revenue / income facts on file", reason: "" },
          { factor: "Loan request / use of proceeds", status: "Supported", evidenceClass: "file_supported", label: "Loan request on file", reason: "" },
          { factor: "AR / customer concentration", status: "Supported", evidenceClass: "file_supported", label: "AR facts on file", reason: "" },
          { factor: "Capacity / staffing", status: "Partially supported", evidenceClass: "borrower_supported", label: "Capacity narrative on file", reason: "" },
          { factor: "Collateral support", status: "Supported", evidenceClass: "file_supported", label: "Collateral on file", reason: "" },
          { factor: "Industry context", status: "Partially supported", evidenceClass: "borrower_supported", label: "NAICS + story", reason: "" },
        ],
        industry: {
          naicsCode: "561422", naicsDescription: "Telemarketing Bureaus",
          understanding: { factor: "Industry understanding", status: "Supported", evidenceClass: "borrower_supported", label: "NAICS + story", reason: "" },
          independentSource: { factor: "Independent industry source", status: "Missing", evidenceClass: "missing", label: "No source", reason: "expected for a private borrower" },
        },
        management: { principals: [{ name: "Matt Hunt", title: "CEO" }], profilePresent: true, publicVerification: true, adverseStatus: "manual_clear_attested" },
        publicRecords: { attestedClear: true, officialCaptured: false, searchFormOnly: false, status: "manual_clear_attested" },
      },
    } as ResearchGateSnapshot;
  }
  const scaleCard = () => buildCommitteeReadinessView(snapshotWithEvidence())!.actionCards.find((c) => c.groupId === "scale")!;
  const html = () =>
    renderToStaticMarkup(
      React.createElement(CommitteeTaskActionCard, { card: scaleCard(), open: false, onToggle: () => {}, onReviewTask: () => {}, onAttachSource: () => {} }),
    );

  it("shows a File-supported evidence-class badge on the scale factor breakdown", () => {
    const out = html();
    assert.match(out, /committee-scale-checklist-scale/);
    assert.match(out, /File-supported/);
    assert.match(out, /Revenue support: Supported/);
  });

  it("shows confidence drivers explaining the badge", () => {
    const out = html();
    assert.match(out, /data-testid="committee-confidence-drivers-scale"/);
    assert.match(out, /Why this confidence/i);
  });
});

// BUGFIX-INDUSTRY-SOURCE-COLLECTED-BLOCKER-COPY-1: the rendered global blocker
// list shows "Industry source review required" (not "… support missing") once an
// independent industry source is collected but not committee-approved.
describe("industry blocker copy is evidence-aware in the rendered blocker list", () => {
  function industrySnapshot(): ResearchGateSnapshot {
    return {
      ...snapshot(),
      committeeBlockerResolutions: [
        blocker({
          blocker_id: "industry_source",
          blocker_type: "section_source_gap",
          title: "Section needs committee-grade sources: Industry Overview",
          current_status: "present_but_not_committee_grade",
          evidence_tasks: [task({ id: "ind", blocker_id: "industry_source", task_type: "industry_market_source", title: "Industry source", status: "collected", resolved_status: "collected", source_snapshot_id: "snap-1" })],
        }),
      ],
      committeeDecisionEvidence: {
        privateCompanyEvidenceMode: true,
        scalePlausibilityUnresolved: false,
        scaleFactors: [],
        industry: { naicsCode: "561422", naicsDescription: null,
          understanding: { factor: "Industry understanding", status: "Supported", evidenceClass: "borrower_supported", label: "x", reason: "" },
          independentSource: { factor: "Independent industry source", status: "Supported", evidenceClass: "public_supported", label: "x", reason: "" } },
        management: { principals: [], profilePresent: false, publicVerification: false, adverseStatus: "not_run" },
        publicRecords: { attestedClear: false, officialCaptured: false, searchFormOnly: false, status: "not_run" },
      } as any,
    } as ResearchGateSnapshot;
  }
  const html = () =>
    renderToStaticMarkup(React.createElement(CommitteeReadinessPanel, { snapshot: industrySnapshot(), onReviewTask: () => {}, onAttachSource: () => {} }));

  it("renders 'Industry source review required', not 'Industry support missing'", () => {
    const out = html();
    assert.match(out, /Industry source review required/);
    assert.doesNotMatch(out, /Industry support missing/);
  });
});
