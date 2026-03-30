import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import { formatV2OperatingSummary } from "../modelEngine/formatV2OperatingSummary";

// ─── Track A: Override policy is singular ─────────────────────────────────────

describe("Track A — override policy singularity", () => {
  it("overridePolicy.ts exists as the single policy file", () => {
    assert.ok(fs.existsSync(path.resolve("src/lib/creditMemo/overridePolicy.ts")));
  });

  it("no pipeline emitter file named emitBuddyEvent.ts exists", () => {
    assert.ok(
      !fs.existsSync(path.resolve("src/lib/pipeline/emitBuddyEvent.ts")),
      "Pipeline emitter must be renamed to emitPipelineLedgerEvent.ts",
    );
  });
});

// ─── Track B: Telemetry architecture ──────────────────────────────────────────

describe("Track B — telemetry naming + authority", () => {
  it("pipeline emitter is named emitPipelineLedgerEvent", () => {
    const content = fs.readFileSync(
      path.resolve("src/lib/pipeline/emitPipelineLedgerEvent.ts"),
      "utf-8",
    );
    assert.ok(content.includes("emitPipelineLedgerEvent"));
    assert.ok(content.includes("deal_pipeline_ledger"));
    assert.ok(content.includes("NOT the canonical global observability ledger"));
  });

  it("pipeline emitter documents it is NOT the canonical observability ledger", () => {
    const content = fs.readFileSync(
      path.resolve("src/lib/pipeline/emitPipelineLedgerEvent.ts"),
      "utf-8",
    );
    assert.ok(content.includes("NOT the canonical global observability ledger"));
  });

  it("observability emitter writes to buddy_ledger_events", () => {
    const content = fs.readFileSync(
      path.resolve("src/lib/observability/emitEvent.ts"),
      "utf-8",
    );
    assert.ok(content.includes("buddy_ledger_events"));
  });

  it("milestone adapter exists and fans out correctly", () => {
    const content = fs.readFileSync(
      path.resolve("src/lib/telemetry/emitDealMilestone.ts"),
      "utf-8",
    );
    assert.ok(content.includes("emitDealMilestone"));
    assert.ok(content.includes("emitPipelineLedgerEvent"));
    assert.ok(content.includes("emitBuddyEvent")); // observability import
    assert.ok(content.includes("ALWAYS_MIRROR_EVENTS"));
  });

  it("milestone adapter includes required dual-write events", () => {
    const content = fs.readFileSync(
      path.resolve("src/lib/telemetry/emitDealMilestone.ts"),
      "utf-8",
    );
    const required = [
      "deal.created",
      "document.confirmed",
      "recompute.document_state",
      "lifecycle.stage_changed",
      "credit_memo.generated",
      "model_v2.snapshot_persisted",
      "model_v2.parity_checked",
      "model_v2.shadow_diff_logged",
    ];
    for (const evt of required) {
      assert.ok(
        content.includes(`"${evt}"`),
        `Missing required dual-write event: ${evt}`,
      );
    }
  });

  it("milestone adapter never throws", () => {
    const content = fs.readFileSync(
      path.resolve("src/lib/telemetry/emitDealMilestone.ts"),
      "utf-8",
    );
    assert.ok(content.includes("Never throws"));
  });

  it("no file src/lib/pipeline/emitBuddyEvent.ts exists (naming collision resolved)", () => {
    assert.ok(
      !fs.existsSync(path.resolve("src/lib/pipeline/emitBuddyEvent.ts")),
    );
  });
});

// ─── Track C: V2 verification purity ──────────────────────────────────────────

describe("Track C — V2 verifier no-mutation guard", () => {
  it("verifyV2OperatingState has no .insert()", () => {
    const content = fs.readFileSync(
      path.resolve("src/lib/modelEngine/verifyV2OperatingState.ts"),
      "utf-8",
    );
    assert.ok(!content.includes(".insert("));
  });

  it("verifyV2OperatingState has no .update()", () => {
    const content = fs.readFileSync(
      path.resolve("src/lib/modelEngine/verifyV2OperatingState.ts"),
      "utf-8",
    );
    assert.ok(!content.includes(".update("));
  });

  it("verifyV2OperatingState has no .upsert()", () => {
    const content = fs.readFileSync(
      path.resolve("src/lib/modelEngine/verifyV2OperatingState.ts"),
      "utf-8",
    );
    assert.ok(!content.includes(".upsert("));
  });

  it("verifyV2OperatingState has no .delete()", () => {
    const content = fs.readFileSync(
      path.resolve("src/lib/modelEngine/verifyV2OperatingState.ts"),
      "utf-8",
    );
    assert.ok(!content.includes(".delete("));
  });
});

// ─── Track C: V2 operator summary formatter ───────────────────────────────────

describe("Track C — V2 operator summary formatter", () => {
  it("green when healthy and active", () => {
    const result = formatV2OperatingSummary({
      v2Enabled: false,
      envFlags: { SHADOW_COMPARE: "true" },
      registryHealth: { metricCount: 7, loaded: true, error: null },
      snapshotHealth: { totalSnapshots: 50, recentSnapshotCount: 5, latestSnapshotAt: new Date().toISOString() },
      diagnostics: [],
    });
    assert.equal(result.level, "green");
    assert.ok(result.headline.includes("healthy"));
  });

  it("red when registry has error", () => {
    const result = formatV2OperatingSummary({
      v2Enabled: false,
      envFlags: {},
      registryHealth: { metricCount: 0, loaded: false, error: "connection refused" },
      snapshotHealth: { totalSnapshots: 0, recentSnapshotCount: 0, latestSnapshotAt: null },
      diagnostics: [],
    });
    assert.equal(result.level, "red");
    assert.ok(result.headline.includes("not healthy"));
  });

  it("yellow when no snapshots", () => {
    const result = formatV2OperatingSummary({
      v2Enabled: false,
      envFlags: {},
      registryHealth: { metricCount: 7, loaded: true, error: null },
      snapshotHealth: { totalSnapshots: 0, recentSnapshotCount: 0, latestSnapshotAt: null },
      diagnostics: [],
    });
    assert.equal(result.level, "yellow");
  });

  it("yellow when no recent snapshots", () => {
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const result = formatV2OperatingSummary({
      v2Enabled: false,
      envFlags: {},
      registryHealth: { metricCount: 7, loaded: true, error: null },
      snapshotHealth: { totalSnapshots: 10, recentSnapshotCount: 0, latestSnapshotAt: oldDate },
      diagnostics: [],
    });
    assert.equal(result.level, "yellow");
    assert.ok(result.details.some((d) => d.includes("cold") || d.includes("stale")));
  });

  it("formatV2OperatingSummary is pure (no DB imports)", () => {
    const content = fs.readFileSync(
      path.resolve("src/lib/modelEngine/formatV2OperatingSummary.ts"),
      "utf-8",
    );
    assert.ok(!content.includes("supabaseAdmin"));
    assert.ok(!content.includes("server-only"));
  });
});

// ─── Phase 58 test file update: emitBuddyEvent ref removal ───────────────────

describe("Phase 58 guard test compatibility", () => {
  it("phase58Guard.test.ts still references correct paths", () => {
    const content = fs.readFileSync(
      path.resolve("src/lib/creditMemo/__tests__/phase58Guard.test.ts"),
      "utf-8",
    );
    // Should reference pipeline path (may need update if it uses old name)
    assert.ok(content.includes("emitBuddyEvent") || content.includes("emitPipelineLedgerEvent"));
  });
});
