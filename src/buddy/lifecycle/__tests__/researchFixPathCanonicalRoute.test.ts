import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { getNextAction } from "@/buddy/lifecycle/nextAction";
import type { LifecycleBlocker, LifecycleState } from "@/buddy/lifecycle/model";

/**
 * SPEC-RESEARCH-FIXPATH-CANONICAL-ROUTE-1
 *
 * getNextAction routed "Run research" to /deals/[dealId]/research, which 404s
 * (no such page route). Memo readiness uses /deals/[dealId]/underwrite for the
 * same missing_research_quality_gate blocker. Both layers must agree on one
 * existing route (/underwrite).
 */

const DEAL = "deal-abc";

function stateWith(blockers: LifecycleBlocker[]): LifecycleState {
  return {
    stage: "underwrite_in_progress",
    lastAdvancedAt: null,
    blockers,
    derived: {} as any,
  };
}

test("Run research routes to the canonical /underwrite page (not the 404 /research)", () => {
  const action = getNextAction(
    stateWith([{ code: "missing_research_quality_gate", message: "x" }]),
    DEAL,
  );
  assert.equal(action.label, "Run research");
  assert.equal((action as any).href, `/deals/${DEAL}/underwrite`);
  assert.ok(
    !/\/research\b/.test((action as any).href),
    "must not target the non-existent /research route",
  );
});

test("research_stalled also avoids the 404 /research route", () => {
  const action = getNextAction(
    stateWith([{ code: "research_stalled", message: "x" }]),
    DEAL,
  );
  assert.ok(
    !/\/research\b/.test((action as any).href ?? ""),
    "research_stalled must not target /research either",
  );
});

test("no nextAction CTA targets the missing /deals/[dealId]/research route", () => {
  const src = fs.readFileSync(
    path.resolve(process.cwd(), "src/buddy/lifecycle/nextAction.ts"),
    "utf8",
  );
  assert.ok(
    !/`\/deals\/\$\{dealId\}\/research`/.test(src),
    "nextAction.ts must not route any CTA to /deals/[dealId]/research (404)",
  );
});

test("getNextAction and memo readiness agree on the research destination", () => {
  const action = getNextAction(
    stateWith([{ code: "missing_research_quality_gate", message: "x" }]),
    DEAL,
  );
  // Memo readiness emits the same blocker with fixPath /deals/[dealId]/underwrite.
  const readinessSrc = fs.readFileSync(
    path.resolve(process.cwd(), "src/lib/creditMemo/inputs/evaluateMemoInputReadiness.ts"),
    "utf8",
  );
  assert.ok(
    /code:\s*"missing_research_quality_gate"[\s\S]{0,160}fixPath:\s*`\/deals\/\$\{dealId\}\/underwrite`/.test(
      readinessSrc,
    ),
    "memo readiness research fixPath must be /underwrite",
  );
  assert.equal(
    (action as any).href,
    `/deals/${DEAL}/underwrite`,
    "rail and memo readiness must point at the same /underwrite destination",
  );
});
