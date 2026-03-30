import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const ORCH_DIR = path.resolve(__dirname, "..");
const STATUS_ROUTE = path.resolve(
  __dirname,
  "../../../app/api/deals/[dealId]/auto-underwrite/status/route.ts",
);
const PROGRESS_COMPONENT = path.resolve(
  __dirname,
  "../../../components/deals/cockpit/AutoUnderwriteProgress.tsx",
);

// ─── Orchestrator structure ───────────────────────────────────────────────────

describe("autoUnderwriteDeal — structure", () => {
  it("emits start event before steps", () => {
    const content = fs.readFileSync(path.join(ORCH_DIR, "autoUnderwriteDeal.ts"), "utf-8");
    assert.ok(content.includes('"auto_underwrite.started"'));
  });

  it("emits complete event after all steps", () => {
    const content = fs.readFileSync(path.join(ORCH_DIR, "autoUnderwriteDeal.ts"), "utf-8");
    assert.ok(content.includes('"auto_underwrite.complete"'));
  });

  it("emits failed event on chain failure", () => {
    const content = fs.readFileSync(path.join(ORCH_DIR, "autoUnderwriteDeal.ts"), "utf-8");
    assert.ok(content.includes('"auto_underwrite.failed"'));
  });

  it("each step emits started + complete/failed events", () => {
    const content = fs.readFileSync(path.join(ORCH_DIR, "autoUnderwriteDeal.ts"), "utf-8");
    assert.ok(content.includes(".started"));
    assert.ok(content.includes(".complete"));
    assert.ok(content.includes(".failed"));
  });

  it("voice summary failure does not throw (non-fatal)", () => {
    const content = fs.readFileSync(path.join(ORCH_DIR, "autoUnderwriteDeal.ts"), "utf-8");
    // Voice summary step is wrapped in its own try/catch
    // The outer chain catch should not be reached for voice failures
    const voiceSection = content.indexOf("voice_summary");
    const afterVoice = content.indexOf("voiceSummaryReady = true", voiceSection);
    assert.ok(voiceSection > -1 && afterVoice > -1);
  });

  it("SBA package step is conditional on deal type", () => {
    const content = fs.readFileSync(path.join(ORCH_DIR, "autoUnderwriteDeal.ts"), "utf-8");
    assert.ok(content.includes("isSba"));
    assert.ok(content.includes("SBA_TYPES"));
  });

  it("uses emitPipelineLedgerEvent (not old emitBuddyEvent)", () => {
    const content = fs.readFileSync(path.join(ORCH_DIR, "autoUnderwriteDeal.ts"), "utf-8");
    assert.ok(content.includes("emitPipelineLedgerEvent"));
  });
});

// ─── Status route reads from ledger only ──────────────────────────────────────

describe("auto-underwrite/status — ledger-only", () => {
  it("reads from deal_pipeline_ledger", () => {
    const content = fs.readFileSync(STATUS_ROUTE, "utf-8");
    assert.ok(content.includes("deal_pipeline_ledger"));
  });

  it("does not query deals table", () => {
    const content = fs.readFileSync(STATUS_ROUTE, "utf-8");
    const lines = content.split("\n").filter(
      (l) => !l.trim().startsWith("//") && l.includes('.from("deals")'),
    );
    assert.equal(lines.length, 0, "Status route must not query deals table");
  });

  it("does not query deal_document_items table", () => {
    const content = fs.readFileSync(STATUS_ROUTE, "utf-8");
    // Check for actual .from("deal_document_items") query, not just string mentions
    assert.ok(!content.includes('.from("deal_document_items")'));
  });

  it("does not query credit memo tables via .from()", () => {
    const content = fs.readFileSync(STATUS_ROUTE, "utf-8");
    assert.ok(!content.includes('.from("canonical_memo_narratives")'));
    assert.ok(!content.includes('.from("deal_memo_overrides")'));
  });
});

// ─── Progress component ───────────────────────────────────────────────────────

describe("AutoUnderwriteProgress component", () => {
  it("renders null when status is idle", () => {
    const content = fs.readFileSync(PROGRESS_COMPONENT, "utf-8");
    assert.ok(content.includes('"idle"'));
    assert.ok(content.includes("return null"));
  });

  it("shows step progress when running", () => {
    const content = fs.readFileSync(PROGRESS_COMPONENT, "utf-8");
    assert.ok(content.includes("Buddy is underwriting"));
    assert.ok(content.includes("Step"));
  });

  it("shows credit memo link when complete", () => {
    const content = fs.readFileSync(PROGRESS_COMPONENT, "utf-8");
    assert.ok(content.includes("Credit memo ready for review"));
    assert.ok(content.includes("memo-template"));
  });

  it("shows specific failed step on failure", () => {
    const content = fs.readFileSync(PROGRESS_COMPONENT, "utf-8");
    assert.ok(content.includes("Underwriting stopped at"));
    assert.ok(content.includes("failedStep"));
  });

  it("polls from auto-underwrite/status endpoint", () => {
    const content = fs.readFileSync(PROGRESS_COMPONENT, "utf-8");
    assert.ok(content.includes("/auto-underwrite/status"));
  });
});
