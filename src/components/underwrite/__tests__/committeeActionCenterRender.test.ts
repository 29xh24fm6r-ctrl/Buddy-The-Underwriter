import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CommitteeReadinessPanel } from "../ResearchGateActionPanel";
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

  it("the adverse card exposes a Record-result primary button inside Next Actions", () => {
    const nextActions = section(render(), "committee-next-actions", "committee-progress-rail");
    assert.match(nextActions, /data-testid="committee-action-primary-risk"/);
    assert.match(nextActions, /Record result/i);
    assert.match(nextActions, /Public screening/i);
  });

  it("the scale card exposes an analyst-conclusion primary button inside Next Actions", () => {
    const nextActions = section(render(), "committee-next-actions", "committee-progress-rail");
    assert.match(nextActions, /data-testid="committee-action-primary-scale"/);
    assert.match(nextActions, /analyst conclusion/i);
  });

  it("hero shows 'Not ready for committee' + actions-required count + a Resolve-now CTA button", () => {
    const html = render();
    const hero = section(html, "committee-readiness-hero", "committee-next-actions");
    assert.match(hero, /Not ready for committee/i);
    assert.match(hero, /data-testid="committee-hero-actions-required"/);
    assert.match(hero, /data-testid="committee-hero-primary"/);
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
});
