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

  it("each card shows decision support by default (why / found / what satisfies)", () => {
    const nextActions = section(render(), "committee-next-actions", "committee-progress-rail");
    assert.match(nextActions, /data-testid="committee-decision-support-/);
    assert.match(nextActions, /Why this matters/i);
    assert.match(nextActions, /Buddy found/i);
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
