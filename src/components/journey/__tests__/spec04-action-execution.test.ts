import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  toCockpitAction,
} from "../../../lib/journey/getNextAction";
import { toCockpitFixAction } from "../../../lib/journey/getBlockerFixAction";
import { runCockpitAction, endpointFor } from "../actions/runCockpitAction";
import type {
  CockpitFixBlockerAction,
  CockpitNavigateAction,
  CockpitRunnableAction,
} from "../actions/actionTypes";

const SHARED = path.resolve(__dirname, "..", "stageViews", "_shared");
const ACTIONS = path.resolve(__dirname, "..", "actions");
const STAGE_VIEWS = path.resolve(__dirname, "..", "stageViews");

const PRIMARY_ACTION_BAR_SRC = fs.readFileSync(
  path.resolve(SHARED, "PrimaryActionBar.tsx"),
  "utf-8",
);
const STAGE_BLOCKER_LIST_SRC = fs.readFileSync(
  path.resolve(SHARED, "StageBlockerList.tsx"),
  "utf-8",
);
const STAGE_WORKSPACE_SHELL_SRC = fs.readFileSync(
  path.resolve(SHARED, "StageWorkspaceShell.tsx"),
  "utf-8",
);
const STAGE_DATA_PROVIDER_SRC = fs.readFileSync(
  path.resolve(SHARED, "StageDataProvider.tsx"),
  "utf-8",
);
const ADVANCED_DISCLOSURE_SRC = fs.readFileSync(
  path.resolve(SHARED, "AdvancedDisclosure.tsx"),
  "utf-8",
);
const USE_COCKPIT_ACTION_SRC = fs.readFileSync(
  path.resolve(ACTIONS, "useCockpitAction.ts"),
  "utf-8",
);
const RUN_COCKPIT_ACTION_SRC = fs.readFileSync(
  path.resolve(ACTIONS, "runCockpitAction.ts"),
  "utf-8",
);
const LOG_COCKPIT_ACTION_SRC = fs.readFileSync(
  path.resolve(ACTIONS, "logCockpitAction.ts"),
  "utf-8",
);
const COMMITTEE_VIEW_SRC = fs.readFileSync(
  path.resolve(STAGE_VIEWS, "CommitteeStageView.tsx"),
  "utf-8",
);
const COMMITTEE_PACKAGE_SRC = fs.readFileSync(
  path.resolve(STAGE_VIEWS, "committee/CommitteePackagePanel.tsx"),
  "utf-8",
);
const CREDIT_MEMO_PANEL_SRC = fs.readFileSync(
  path.resolve(STAGE_VIEWS, "committee/CreditMemoPanel.tsx"),
  "utf-8",
);
const MEMO_RECON_PANEL_SRC = fs.readFileSync(
  path.resolve(STAGE_VIEWS, "committee/MemoReconciliationPanel.tsx"),
  "utf-8",
);

function makeFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  return impl as unknown as typeof fetch;
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("SPEC-04 — runCockpitAction executor", () => {
  it("V2: navigate intent does NOT call fetch", async () => {
    let called = 0;
    const action: CockpitNavigateAction = {
      intent: "navigate",
      label: "Open",
      href: "/deals/x/cockpit",
    };
    const result = await runCockpitAction(
      action,
      "deal-1",
      makeFetch(async () => {
        called++;
        return jsonResponse({ ok: true });
      }),
    );
    assert.equal(called, 0);
    assert.equal(result.ok, true);
  });

  it("V3: runnable intent POSTs to the endpoint mapped by actionType", async () => {
    const calls: { url: string; method?: string; body?: string }[] = [];
    const action: CockpitRunnableAction = {
      intent: "runnable",
      label: "Generate Packet",
      actionType: "generate_packet",
    };
    const result = await runCockpitAction(
      action,
      "deal-1",
      makeFetch(async (url, init) => {
        calls.push({
          url: String(url),
          method: init?.method,
          body: typeof init?.body === "string" ? init.body : undefined,
        });
        return jsonResponse({ ok: true });
      }),
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, endpointFor("generate_packet", "deal-1"));
    assert.equal(calls[0].method, "POST");
    assert.match(calls[0].body ?? "", /"source":"stage_cockpit"/);
    assert.match(calls[0].body ?? "", /"intent":"runnable"/);
    assert.equal(result.ok, true);
  });

  it("V4: fix_blocker intent POSTs to the endpoint and tags the blockerId", async () => {
    let captured: { url: string; body?: string } | null = null;
    const action: CockpitFixBlockerAction = {
      intent: "fix_blocker",
      label: "Generate Snapshot",
      actionType: "generate_snapshot",
      blockerId: "financial_snapshot_missing",
    };
    const result = await runCockpitAction(
      action,
      "deal-1",
      makeFetch(async (url, init) => {
        captured = {
          url: String(url),
          body: typeof init?.body === "string" ? init.body : undefined,
        };
        return jsonResponse({ ok: true });
      }),
    );
    assert.ok(captured, "fetch must be called");
    assert.equal(captured!.url, endpointFor("generate_snapshot", "deal-1"));
    assert.match(captured!.body ?? "", /"intent":"fix_blocker"/);
    assert.match(
      captured!.body ?? "",
      /"blockerId":"financial_snapshot_missing"/,
    );
    assert.equal(result.ok, true);
  });

  it("non-2xx response surfaces an error result with errorMessage", async () => {
    const action: CockpitRunnableAction = {
      intent: "runnable",
      label: "Generate Snapshot",
      actionType: "generate_snapshot",
    };
    const result = await runCockpitAction(
      action,
      "deal-1",
      makeFetch(async () =>
        new Response(JSON.stringify({ ok: false, error: "snapshot_busy" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    assert.equal(result.ok, false);
    assert.equal(result.errorMessage, "snapshot_busy");
    assert.equal(result.httpStatus, 503);
  });
});

describe("SPEC-04 — toCockpitAction adapter (lifecycle → CockpitAction)", () => {
  it("converts navigate-style actions", () => {
    const out = toCockpitAction({
      label: "Set Up Intake",
      href: "/deals/d/cockpit?tab=setup",
      intent: "navigate",
    });
    assert.deepEqual(out, {
      intent: "navigate",
      label: "Set Up Intake",
      href: "/deals/d/cockpit?tab=setup",
      description: undefined,
    });
  });

  it("converts runnable actions when serverAction is supported", () => {
    const out = toCockpitAction({
      label: "Generate Snapshot",
      intent: "runnable",
      serverAction: "generate_snapshot",
    });
    assert.equal(out?.intent, "runnable");
    if (out?.intent === "runnable") {
      assert.equal(out.actionType, "generate_snapshot");
    }
  });

  it("returns null for complete and blocked intents", () => {
    assert.equal(
      toCockpitAction({ label: "Closed", intent: "complete" }),
      null,
    );
    assert.equal(
      toCockpitAction({ label: "Resolve Blockers", intent: "blocked" }),
      null,
    );
  });

  it("toCockpitFixAction maps lifecycle action shorthand to runnable fix", () => {
    const out = toCockpitFixAction(
      { label: "Generate Snapshot", action: "generate_snapshot.recompute" },
      "financial_snapshot_missing",
    );
    assert.equal(out?.intent, "fix_blocker");
    if (out?.intent === "fix_blocker") {
      assert.equal(out.actionType, "generate_snapshot");
      assert.equal(out.blockerId, "financial_snapshot_missing");
    }
  });

  it("toCockpitFixAction falls through to navigate for href-style fixes", () => {
    const out = toCockpitFixAction(
      { label: "Open", href: "/deals/d/decision" },
      "decision_missing",
    );
    assert.equal(out?.intent, "navigate");
    if (out?.intent === "navigate") {
      assert.equal(out.href, "/deals/d/decision");
    }
  });
});

describe("SPEC-04 — PrimaryActionBar contract", () => {
  it("V1: navigates by calling router via useCockpitAction (no <Link>)", () => {
    // SPEC-04 PrimaryActionBar uses a <button> + useCockpitAction.run rather
    // than a <Link>, so navigation runs through the same telemetry pipeline
    // as runnable actions. The Link import was removed.
    assert.ok(!/import Link from "next\/link"/.test(PRIMARY_ACTION_BAR_SRC));
    assert.ok(PRIMARY_ACTION_BAR_SRC.includes("useCockpitAction"));
  });

  it("V5: pending action disables the button and shows loading state", () => {
    assert.ok(PRIMARY_ACTION_BAR_SRC.includes("disabled={isPending}"));
    assert.ok(PRIMARY_ACTION_BAR_SRC.includes('aria-busy={isPending}'));
    assert.match(PRIMARY_ACTION_BAR_SRC, /Running…/);
  });

  it("V8: failed action renders an inline error chip", () => {
    assert.ok(PRIMARY_ACTION_BAR_SRC.includes('data-testid="primary-action-error"'));
    assert.ok(PRIMARY_ACTION_BAR_SRC.includes('role="alert"'));
  });

  it("V15: stage views never render <PrimaryActionBar> (shell still owns it)", () => {
    for (const file of [
      "CommitteeStageView.tsx",
      "DecisionStageView.tsx",
      "ClosingStageView.tsx",
      "IntakeStageView.tsx",
      "DocumentsStageView.tsx",
      "UnderwritingStageView.tsx",
      "WorkoutStageView.tsx",
    ]) {
      const src = fs.readFileSync(path.resolve(STAGE_VIEWS, file), "utf-8");
      assert.ok(
        !src.includes("<PrimaryActionBar"),
        `${file} must not render <PrimaryActionBar> directly`,
      );
    }
    const matches = STAGE_WORKSPACE_SHELL_SRC.match(/<PrimaryActionBar\b/g) ?? [];
    assert.equal(matches.length, 1);
  });
});

describe("SPEC-04 — useCockpitAction wires refresh + telemetry", () => {
  it("V6: successful run calls refreshStageData", () => {
    assert.ok(
      USE_COCKPIT_ACTION_SRC.includes("await refreshStageData()"),
      "useCockpitAction must await refreshStageData() on success",
    );
  });

  it("V7: navigate intent calls router.push (router.refresh is implicit via Next on push)", () => {
    assert.ok(USE_COCKPIT_ACTION_SRC.includes("router.push(action.href)"));
    // The shared StageDataProvider invokes router.refresh inside refreshStageData,
    // so non-navigate successes also force a refresh.
    assert.ok(STAGE_DATA_PROVIDER_SRC.includes("router.refresh()"));
  });

  it("V13: action telemetry logs started + succeeded/failed", () => {
    assert.ok(USE_COCKPIT_ACTION_SRC.includes("logCockpitActionStarted"));
    assert.ok(USE_COCKPIT_ACTION_SRC.includes("logCockpitActionResult"));
    // Started + success/fail kinds wired in logCockpitAction.
    assert.ok(LOG_COCKPIT_ACTION_SRC.includes("cockpit_action_started"));
    assert.ok(LOG_COCKPIT_ACTION_SRC.includes("cockpit_action_succeeded"));
    assert.ok(LOG_COCKPIT_ACTION_SRC.includes("cockpit_action_failed"));
  });

  it("V14: blocker fix telemetry has its own started/succeeded/failed kinds", () => {
    assert.ok(LOG_COCKPIT_ACTION_SRC.includes("blocker_fix_started"));
    assert.ok(LOG_COCKPIT_ACTION_SRC.includes("blocker_fix_succeeded"));
    assert.ok(LOG_COCKPIT_ACTION_SRC.includes("blocker_fix_failed"));
  });

  it("telemetry posts to canonical /api/buddy/signals/record", () => {
    assert.ok(LOG_COCKPIT_ACTION_SRC.includes('"/api/buddy/signals/record"'));
  });

  it("source is always 'stage_cockpit'", () => {
    assert.ok(LOG_COCKPIT_ACTION_SRC.includes('source: "stage_cockpit"'));
  });
});

describe("SPEC-04 — StageBlockerList uses unified executor", () => {
  it("V4 (blocker side): StageBlockerList runs fix actions via useCockpitAction", () => {
    assert.ok(STAGE_BLOCKER_LIST_SRC.includes("useCockpitAction"));
    // It now uses adapter from src/lib/journey, not raw lifecycle helper.
    assert.ok(
      STAGE_BLOCKER_LIST_SRC.includes('@/lib/journey/getBlockerFixAction'),
    );
  });

  it("renders a button (executable), not just a Link, when fix is available", () => {
    assert.match(STAGE_BLOCKER_LIST_SRC, /<button[\s\S]*data-testid="blocker-fix-action"/);
  });
});

describe("SPEC-04 — committee memo data is owned by the stage", () => {
  it("V10: CommitteeStageView fetches /credit-memo/canonical/missing once", () => {
    const occurrences = COMMITTEE_VIEW_SRC.match(
      /\/credit-memo\/canonical\/missing/g,
    ) ?? [];
    assert.equal(
      occurrences.length,
      1,
      "stage view should fetch the memo summary endpoint exactly once",
    );
    assert.ok(COMMITTEE_VIEW_SRC.includes("memoSummary={memoSummary}"));
    assert.ok(COMMITTEE_VIEW_SRC.includes("useRegisterStageRefresher"));
  });

  it("V11: CreditMemoPanel does not fetch independently", () => {
    assert.ok(
      !/fetch\s*\(/.test(CREDIT_MEMO_PANEL_SRC),
      "CreditMemoPanel must not call fetch — data flows from the stage",
    );
    assert.ok(!CREDIT_MEMO_PANEL_SRC.includes("useJsonFetch"));
    assert.ok(CREDIT_MEMO_PANEL_SRC.includes("memoSummary"));
  });

  it("V12: MemoReconciliationPanel does not fetch independently", () => {
    assert.ok(
      !/fetch\s*\(/.test(MEMO_RECON_PANEL_SRC),
      "MemoReconciliationPanel must not call fetch — data flows from the stage",
    );
    assert.ok(!MEMO_RECON_PANEL_SRC.includes("useJsonFetch"));
    assert.ok(MEMO_RECON_PANEL_SRC.includes("memoSummary"));
  });
});

describe("SPEC-04 — generate_packet flows through shared action system", () => {
  it("V9: CommitteePackagePanel does NOT call /committee/packet/generate directly", () => {
    assert.ok(
      !COMMITTEE_PACKAGE_SRC.includes("/committee/packet/generate"),
      "panel should rely on runCockpitAction's endpoint mapping, not a literal URL",
    );
  });

  it("CommitteePackagePanel uses useCockpitAction with actionType=generate_packet", () => {
    assert.ok(COMMITTEE_PACKAGE_SRC.includes("useCockpitAction"));
    assert.ok(COMMITTEE_PACKAGE_SRC.includes('actionType: "generate_packet"'));
    assert.ok(COMMITTEE_PACKAGE_SRC.includes('intent: "runnable"'));
  });

  it("runCockpitAction's endpoint table includes generate_packet → committee/packet/generate", () => {
    assert.ok(
      RUN_COCKPIT_ACTION_SRC.includes("/committee/packet/generate"),
      "the URL should live in the executor's endpoint table, not in panels",
    );
  });
});

describe("SPEC-04 — preserved invariants from earlier specs", () => {
  it("V16: ForceAdvancePanel remains nested inside <AdvancedDisclosure>", () => {
    for (const file of [
      "CommitteeStageView.tsx",
      "DecisionStageView.tsx",
      "ClosingStageView.tsx",
    ]) {
      const src = fs.readFileSync(path.resolve(STAGE_VIEWS, file), "utf-8");
      const fa = src.indexOf("<ForceAdvancePanel");
      if (fa < 0) continue;
      const ad = src.lastIndexOf("<AdvancedDisclosure", fa);
      const closeAd = src.indexOf("</AdvancedDisclosure>", ad);
      assert.ok(
        ad >= 0 && fa > ad && (closeAd === -1 || fa < closeAd),
        `${file}: ForceAdvancePanel must be inside <AdvancedDisclosure>`,
      );
    }
  });

  it("AdvancedDisclosure remains closed by default", () => {
    assert.ok(ADVANCED_DISCLOSURE_SRC.includes("<details"));
    assert.ok(!/<details[^>]*\bopen\b/.test(ADVANCED_DISCLOSURE_SRC));
  });
});
