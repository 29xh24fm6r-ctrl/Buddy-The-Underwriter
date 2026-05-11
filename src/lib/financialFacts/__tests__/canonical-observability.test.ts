/**
 * SPEC-FOUNDATION-V1 PR5d — Canonical recompute observability guards.
 *
 * Verifies the five canonical.recompute.* event types exist in
 * spreadsProcessor at the correct chain steps.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");
const SP_PATH = join(REPO_ROOT, "src/lib/jobs/processors/spreadsProcessor.ts");

function read(): string {
  return readFileSync(SP_PATH, "utf8");
}

// ── Event existence guards ─────────────────────────────────────────────────

test("[pr5d-1] spreadsProcessor emits canonical.recompute.backfill.completed", () => {
  assert.match(read(), /canonical\.recompute\.backfill\.completed/);
});

test("[pr5d-2] spreadsProcessor emits canonical.recompute.aggregator.completed", () => {
  assert.match(read(), /canonical\.recompute\.aggregator\.completed/);
});

test("[pr5d-3] spreadsProcessor emits canonical.recompute.compute_total_debt_service.completed", () => {
  assert.match(read(), /canonical\.recompute\.compute_total_debt_service\.completed/);
});

test("[pr5d-4] spreadsProcessor emits canonical.recompute.gcf.completed", () => {
  assert.match(read(), /canonical\.recompute\.gcf\.completed/);
});

test("[pr5d-5] spreadsProcessor emits canonical.recompute.spread_rendered", () => {
  assert.match(read(), /canonical\.recompute\.spread_rendered/);
});

// ── triggerReason propagation ──────────────────────────────────────────────

test("[pr5d-6] all five canonical events include triggerReason in meta", () => {
  const body = read();
  // Strip comments to find event in eventKey strings, not comment text
  const stripped = body.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const events = [
    "canonical.recompute.backfill.completed",
    "canonical.recompute.aggregator.completed",
    "canonical.recompute.compute_total_debt_service.completed",
    "canonical.recompute.gcf.completed",
    "canonical.recompute.spread_rendered",
  ];
  for (const event of events) {
    const eventIdx = stripped.indexOf(event);
    assert.ok(eventIdx > 0, `Event ${event} not found in non-comment code`);
    // Check the next 500 chars for triggerReason in meta
    const context = stripped.slice(eventIdx, eventIdx + 500);
    assert.match(
      context,
      /triggerReason/,
      `Event ${event} must include triggerReason in its meta.`,
    );
  }
});

// ── Fire-and-forget pattern ────────────────────────────────────────────────

test("[pr5d-7] all five canonical events are fire-and-forget (void or .catch)", () => {
  const body = read();
  // Strip comments so we find the event in the actual eventKey string, not in comment text
  const stripped = body.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const events = [
    "canonical.recompute.backfill.completed",
    "canonical.recompute.aggregator.completed",
    "canonical.recompute.compute_total_debt_service.completed",
    "canonical.recompute.gcf.completed",
    "canonical.recompute.spread_rendered",
  ];
  for (const event of events) {
    const eventIdx = stripped.indexOf(event);
    assert.ok(eventIdx > 0, `Event ${event} not found in non-comment code`);
    const preceding = stripped.slice(Math.max(0, eventIdx - 200), eventIdx);
    const following = stripped.slice(eventIdx, eventIdx + 200);
    const hasVoid = preceding.includes("void ");
    const hasCatch = following.includes(".catch(");
    assert.ok(
      hasVoid || hasCatch,
      `Event ${event} must be fire-and-forget (void or .catch).`,
    );
  }
});

// ── Spread render timing notes ─────────────────────────────────────────────

test("[pr5d-8] spread_rendered event captures timing context (rendered_at_chain_step_2)", () => {
  const body = read();
  assert.match(
    body,
    /rendered_at_chain_step_2/,
    "spread_rendered event must include 'rendered_at_chain_step_2' note documenting the timing gap.",
  );
});

// ── Ordering guards ────────────────────────────────────────────────────────

test("[pr5d-9] canonical events appear in correct chain order", () => {
  const body = read();
  const stripped = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  const backfillIdx = stripped.indexOf("canonical.recompute.backfill.completed");
  const aggIdx = stripped.indexOf("canonical.recompute.aggregator.completed");
  const tdsIdx = stripped.indexOf("canonical.recompute.compute_total_debt_service.completed");
  const gcfIdx = stripped.indexOf("canonical.recompute.gcf.completed");

  assert.ok(backfillIdx > 0, "backfill event not found");
  assert.ok(aggIdx > backfillIdx, "aggregator event must come after backfill");
  assert.ok(tdsIdx > aggIdx, "TDS event must come after aggregator");
  assert.ok(gcfIdx > tdsIdx, "GCF event must come after TDS");
});

test("[pr5d-10] spread_rendered event is emitted before backfill (renders at chain step 2)", () => {
  const body = read();
  const stripped = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const spreadIdx = stripped.indexOf("canonical.recompute.spread_rendered");
  const backfillIdx = stripped.indexOf("canonical.recompute.backfill.completed");
  assert.ok(spreadIdx > 0, "spread_rendered event not found");
  assert.ok(backfillIdx > 0, "backfill event not found");
  assert.ok(
    spreadIdx < backfillIdx,
    "spread_rendered must appear BEFORE backfill in source (renders at chain step 2, before step 3+).",
  );
});

// ── No blocking ────────────────────────────────────────────────────────────

test("[pr5d-11] no canonical event uses await (all fire-and-forget)", () => {
  const body = read();
  const lines = body.split("\n");
  for (const line of lines) {
    if (line.includes("canonical.recompute.") && line.includes("logLedgerEvent")) {
      assert.ok(
        !line.trimStart().startsWith("await"),
        `Canonical event must not use await: ${line.trim().slice(0, 80)}`,
      );
    }
  }
});
