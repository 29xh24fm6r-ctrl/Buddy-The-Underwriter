/**
 * SPEC-UNDERWRITE-RESEARCH-GATE-END-TO-END-1
 *
 * Regression guards for the canonical research resolution path on
 * /deals/[dealId]/underwrite. Covers the full research-gate state machine,
 * the lifecycle routing fix (research blocker → /underwrite, never /research),
 * and the no-duplicate-route invariant.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import { deriveResearchGatePhase } from "../researchGatePhase";
import { EMPTY_RESEARCH_GATE_SNAPSHOT, type ResearchGateSnapshot } from "../researchGateTypes";
import { getBlockerFixAction, getNextAction } from "../../../buddy/lifecycle/nextAction";
import { buildJourneyPrimaryAction } from "../../../lib/journey/journeyActionProjection";
import { endpointFor } from "../../journey/actions/runCockpitAction";
import type { LifecycleBlocker } from "../../../buddy/lifecycle/model";

const DEAL = "dc52c626-0000-0000-0000-000000000000";

function snap(overrides: Partial<ResearchGateSnapshot> = {}): ResearchGateSnapshot {
  return { ...EMPTY_RESEARCH_GATE_SNAPSHOT, ...overrides };
}

describe("ResearchGateActionPanel phase machine", () => {
  it("no workspace + no mission + gate not passed → needs_workbench (A)", () => {
    const phase = deriveResearchGatePhase(snap(), /* workspaceReady */ false, null);
    assert.equal(phase, "needs_workbench");
  });

  it("workspace exists + no mission → no_mission / Run Research (B)", () => {
    const phase = deriveResearchGatePhase(snap({ missionStatus: null }), true, null);
    assert.equal(phase, "no_mission");
  });

  it("mission queued → running (C)", () => {
    assert.equal(deriveResearchGatePhase(snap({ missionStatus: "queued" }), true, null), "running");
  });

  it("mission running → running (C)", () => {
    assert.equal(deriveResearchGatePhase(snap({ missionStatus: "running" }), true, null), "running");
  });

  it("run in flight forces running regardless of stale status (C)", () => {
    assert.equal(deriveResearchGatePhase(snap({ missionStatus: "failed" }), true, "run"), "running");
  });

  it("mission failed → failed / Re-run Research (D)", () => {
    assert.equal(deriveResearchGatePhase(snap({ missionStatus: "failed" }), true, null), "failed");
  });

  it("mission cancelled → failed / Re-run Research (D)", () => {
    assert.equal(deriveResearchGatePhase(snap({ missionStatus: "cancelled" }), true, null), "failed");
  });

  it("mission complete but gate not passed → gate_failed (E)", () => {
    const phase = deriveResearchGatePhase(
      snap({ missionStatus: "complete", gatePassed: false, gateFailures: ["x"] }),
      true,
      null,
    );
    assert.equal(phase, "gate_failed");
  });

  it("gate passed → passed / no research CTA (F)", () => {
    assert.equal(
      deriveResearchGatePhase(snap({ gatePassed: true, missionStatus: "complete" }), true, null),
      "passed",
    );
  });

  it("gate passed wins even with no workspace (F before A)", () => {
    assert.equal(deriveResearchGatePhase(snap({ gatePassed: true }), false, null), "passed");
  });
});

describe("research blocker routing", () => {
  it("missing_research_quality_gate routes to /underwrite, never /research", () => {
    const blocker = {
      code: "missing_research_quality_gate",
      message: "Research quality gate must pass",
    } as unknown as LifecycleBlocker;
    const action = getBlockerFixAction(blocker, DEAL);
    assert.ok(action && "action" in action, "expected a one-click fix action");
    assert.equal((action as { action: string }).action, "research.run");
    assert.equal((action as { fallbackHref?: string }).fallbackHref, `/deals/${DEAL}/underwrite#research-gate`);
    assert.equal(action.label, "Run research");
  });
});

describe("CommitteeReadinessPanel — single command surface (SPEC-…-SINGLE-COMMAND-SURFACE-1)", () => {
  const SRC = fs.readFileSync(
    path.resolve(__dirname, "..", "ResearchGateActionPanel.tsx"),
    "utf8",
  );

  it("internal detail lives behind ONE collapsed 'Supporting details' disclosure", () => {
    assert.match(SRC, /Supporting details/);
    assert.doesNotMatch(SRC, /Show audit details/);
  });

  it("evidence plan + audit are folded into Supporting details (single disclosure)", () => {
    assert.match(SRC, /CommitteeRequirements plan=\{snapshot\.committeeRequirementsPlan\}/);
    assert.match(SRC, /CommitteeReadinessAuditTable rows=\{view\.audit\}/);
  });

  it("blocker resolutions inside the audit disclosure are read-only (no duplicate review buttons)", () => {
    // The audit disclosure must render CommitteeBlockerResolutions WITHOUT
    // onReviewTask, so the five group cards remain the single action surface.
    assert.match(SRC, /<CommitteeBlockerResolutions items=\{snapshot\.committeeBlockerResolutions\} \/>/);
  });
});

describe("CommitteeReadinessPanel — source guards (still cheap to assert)", () => {
  const SRC = fs.readFileSync(path.resolve(__dirname, "..", "ResearchGateActionPanel.tsx"), "utf8");
  it("one canonical action component (no separate passive queue / TaskActionRow)", () => {
    assert.match(SRC, /CommitteeTaskActionCard/);
    assert.doesNotMatch(SRC, /function NextActionsQueue/);
    assert.doesNotMatch(SRC, /function TaskActionRow/);
  });
  it("Evidence Status group card no longer takes action handlers (read-only)", () => {
    assert.doesNotMatch(SRC, /CommitteeReadinessSummaryCard/);
    assert.doesNotMatch(SRC, /ScalePlausibilityCallout/);
  });
  it("captured sources distinguish Official capture from Buddy receipt", () => {
    assert.match(SRC, /Official capture/);
    assert.match(SRC, /Buddy receipt only/);
  });
  it("progress rail is read-only (no group action handlers / details expansion)", () => {
    assert.match(SRC, /CommitteeProgressRail/);
    assert.doesNotMatch(SRC, /function CommitteeReadinessGroupCard/);
  });
});

describe("no duplicate research source of truth", () => {
  it("no source file links to the non-existent /deals/[dealId]/research route", () => {
    // The route intentionally does not exist, so any fixPath/href pointing at
    // it is a guaranteed 404 in the user's face. getBlockerFixAction was fixed
    // for this once (SPEC-RESEARCH-FIXPATH-CANONICAL-ROUTE-1) but four readiness
    // and committee-rule call sites still built the dead path and were caught
    // 404ing in production. Guard the whole tree, not just the lifecycle layer.
    const srcRoot = path.resolve(__dirname, "..", "..", "..");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === "__tests__") continue;
          walk(full);
        } else if (/\.tsx?$/.test(entry.name)) {
          const text = fs.readFileSync(full, "utf8");
          // Template-literal deal routes ending in /research, e.g.
          // `/deals/${dealId}/research`. API routes (/api/...) are unaffected.
          if (/deals\/\$\{[^}]+\}\/research`/.test(text)) {
            offenders.push(path.relative(srcRoot, full));
          }
        }
      }
    };
    walk(srcRoot);
    assert.deepEqual(
      offenders,
      [],
      `these files link to the non-existent /deals/[dealId]/research route: ${offenders.join(", ")}`,
    );
  });

  it("no /deals[dealId]/research page route exists".replace("[", "/["), () => {
    const appRoot = path.resolve(__dirname, "..", "..", "..", "app");
    const candidates = [
      path.join(appRoot, "(app)", "deals", "[dealId]", "research", "page.tsx"),
      path.join(appRoot, "deals", "[dealId]", "research", "page.tsx"),
    ];
    for (const p of candidates) {
      assert.equal(fs.existsSync(p), false, `unexpected research page route at ${p}`);
    }
  });
});

describe("Re-run Research forces a fresh mission (idempotent /run silently reused the old one)", () => {
  const PANEL = fs.readFileSync(path.resolve(__dirname, "..", "ResearchGateActionPanel.tsx"), "utf8");
  const WORKBENCH = fs.readFileSync(path.resolve(__dirname, "..", "AnalystWorkbench.tsx"), "utf8");

  it("every Re-run Research button passes { rerun: true }", () => {
    const rerunButtons = PANEL.match(/label="Re-run Research"[\s\S]{0,200}?onClick=\{([^}]*\})?[^}]*\}/g) ?? [];
    assert.ok(rerunButtons.length >= 2, "expected the failed and gate_failed Re-run buttons");
    for (const b of rerunButtons) {
      assert.match(b, /onRunResearch\(\{ rerun: true \}\)/, `Re-run button must force a fresh mission: ${b}`);
    }
  });

  it("the initial Run Research button stays idempotent (no rerun flag)", () => {
    const m = PANEL.match(/label="Run Research"[\s\S]{0,200}?onClick=\{([^}]*)\}/);
    assert.ok(m, "expected the no_mission Run Research button");
    assert.ok(!/rerun: true/.test(m![0]), "first run must not force a rerun");
  });

  it("workbench posts force_rerun to /research/run when rerun is requested and surfaces duplicate reuse", () => {
    assert.match(WORKBENCH, /\/api\/deals\/\$\{dealId\}\/research\/run/);
    assert.match(WORKBENCH, /opts\?\.rerun[\s\S]{0,200}force_rerun: true/);
    assert.match(WORKBENCH, /payload\?\.duplicate === true/);
  });

  it("run handler honors the force_rerun body flag", () => {
    const RUN = fs.readFileSync(
      path.resolve(__dirname, "..", "..", "..", "app", "api", "deals", "[dealId]", "research", "[action]", "_handlers", "run.ts"),
      "utf8",
    );
    assert.match(RUN, /if \(body\.force_rerun === true\) forceRerun = true;/);
    assert.match(RUN, /forceRerun,\s*\}\);/);
  });

  it("panel exposes the #research-gate anchor the lifecycle CTA deep-links to", () => {
    assert.match(PANEL, /id="research-gate"/);
  });
});


describe("rail 'Run research' starts the mission itself (one click, no second button)", () => {
  const STAGE_ROW = fs.readFileSync(path.resolve(__dirname, "..", "..", "journey", "StageRow.tsx"), "utf8");
  const WORKBENCH = fs.readFileSync(path.resolve(__dirname, "..", "AnalystWorkbench.tsx"), "utf8");

  it("lifecycle next action for the research blocker is runnable run_research with the panel as href", () => {
    const state = {
      stage: "underwrite_in_progress",
      lastAdvancedAt: null,
      blockers: [{ code: "missing_research_quality_gate", message: "x" }],
      derived: {},
    } as unknown as Parameters<typeof getNextAction>[0];
    const a = getNextAction(state, DEAL);
    assert.equal(a.intent, "runnable");
    assert.equal(a.serverAction, "run_research");
    assert.equal(a.href, `/deals/${DEAL}/underwrite#research-gate`);
    const rail = buildJourneyPrimaryAction(state, DEAL);
    assert.equal(rail.intent, "runnable");
    assert.equal(rail.serverAction, "run_research");
    assert.equal(rail.label, "Run research");
  });

  it("research_stalled (the blocker the unified readiness layer raises) is the same one-click action", () => {
    const fix = getBlockerFixAction({ code: "research_stalled", message: "x" } as unknown as LifecycleBlocker, DEAL);
    assert.ok(fix && "action" in fix);
    assert.equal((fix as { action: string }).action, "research.run");
    assert.equal((fix as { fallbackHref?: string }).fallbackHref, `/deals/${DEAL}/underwrite#research-gate`);
    const state = {
      stage: "underwrite_in_progress",
      lastAdvancedAt: null,
      blockers: [{ code: "research_stalled", message: "x" }],
      derived: {},
    } as unknown as Parameters<typeof getNextAction>[0];
    const rail = buildJourneyPrimaryAction(state, DEAL);
    assert.equal(rail.intent, "runnable");
    assert.equal(rail.serverAction, "run_research");
  });

  it("run_research posts to /research/run with force_rerun", () => {
    assert.equal(endpointFor("run_research", DEAL), `/api/deals/${DEAL}/research/run`);
    assert.match(STAGE_ROW, /run_research: \{ force_rerun: true \}/);
  });

  it("the rail renders a real button for runnable server actions and hands off to an on-page owner first", () => {
    assert.match(STAGE_ROW, /action\.intent === "runnable" && action\.serverAction/);
    assert.match(STAGE_ROW, /new CustomEvent<RailActionEventDetail>\(RAIL_ACTION_EVENT/);
    assert.match(STAGE_ROW, /runCockpitAction\(/);
  });

  it("the workbench takes over run_research from the rail with its own pending UI", () => {
    assert.match(WORKBENCH, /addEventListener\(RAIL_ACTION_EVENT/);
    assert.match(WORKBENCH, /detail\.actionType !== "run_research"/);
    assert.match(WORKBENCH, /ev\.preventDefault\(\);\s*void runResearch\(\{ rerun: true \}\)/);
  });
});


describe("forced re-run creates a fresh mission despite the active run_key unique index", () => {
  const RUN_MISSION = fs.readFileSync(
    path.resolve(__dirname, "..", "..", "..", "lib", "research", "runMission.ts"),
    "utf8",
  );

  it("forceRerun derives a distinct run_key instead of reusing the completed mission's key", () => {
    // The unique index (deal_id, run_key) WHERE status IN (queued, running,
    // complete) rejects a second insert with the same key while the old
    // COMPLETE mission exists, and createMission() reports it as duplicate.
    assert.match(RUN_MISSION, /const runKey = opts\?\.forceRerun\s*\?\s*`\$\{baseRunKey\}:rerun:/);
    assert.match(RUN_MISSION, /const baseRunKey = generateRunKey\(/);
  });
});
