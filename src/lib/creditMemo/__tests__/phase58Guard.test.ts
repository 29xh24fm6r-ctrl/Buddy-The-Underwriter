import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  isPermittedOverrideKey,
  filterQualitativeOverrides,
  PERMITTED_OVERRIDE_KEYS,
} from "../overridePolicy";

// ─── Track A: Override policy ─────────────────────────────────────────────────

describe("Override policy — qualitative only", () => {
  it("permits business_description", () => {
    assert.equal(isPermittedOverrideKey("business_description"), true);
  });

  it("permits use_of_proceeds", () => {
    assert.equal(isPermittedOverrideKey("use_of_proceeds"), true);
  });

  it("permits management_assessment", () => {
    assert.equal(isPermittedOverrideKey("management_assessment"), true);
  });

  it("permits collateral_description", () => {
    assert.equal(isPermittedOverrideKey("collateral_description"), true);
  });

  it("permits competitive_position", () => {
    assert.equal(isPermittedOverrideKey("competitive_position"), true);
  });

  it("permits committee_notes", () => {
    assert.equal(isPermittedOverrideKey("committee_notes"), true);
  });

  it("permits principal_bio_* pattern", () => {
    assert.equal(isPermittedOverrideKey("principal_bio_john_smith"), true);
    assert.equal(isPermittedOverrideKey("principal_bio_0"), true);
    assert.equal(isPermittedOverrideKey("principal_name_0"), true);
  });

  it("permits guarantor_bio_* pattern", () => {
    assert.equal(isPermittedOverrideKey("guarantor_bio_jane"), true);
  });

  // Forbidden keys — numeric/computed
  it("rejects dscr", () => {
    assert.equal(isPermittedOverrideKey("dscr"), false);
    assert.equal(isPermittedOverrideKey("dscr_year1"), false);
    assert.equal(isPermittedOverrideKey("projected_dscr"), false);
  });

  it("rejects revenue", () => {
    assert.equal(isPermittedOverrideKey("revenue"), false);
    assert.equal(isPermittedOverrideKey("total_revenue"), false);
  });

  it("rejects ebitda", () => {
    assert.equal(isPermittedOverrideKey("ebitda"), false);
    assert.equal(isPermittedOverrideKey("ebitda_margin"), false);
  });

  it("rejects ltv/ltc", () => {
    assert.equal(isPermittedOverrideKey("ltv"), false);
    assert.equal(isPermittedOverrideKey("ltc_ratio"), false);
  });

  it("rejects loan_amount", () => {
    assert.equal(isPermittedOverrideKey("loan_amount"), false);
  });

  it("rejects collateral_value", () => {
    assert.equal(isPermittedOverrideKey("collateral_value"), false);
  });

  it("rejects debt_service", () => {
    assert.equal(isPermittedOverrideKey("annual_debt_service"), false);
  });

  it("rejects unknown keys by default (fail-safe)", () => {
    assert.equal(isPermittedOverrideKey("some_unknown_key_xyz"), false);
  });
});

describe("filterQualitativeOverrides", () => {
  it("accepts narrative keys, rejects numeric keys", () => {
    const { accepted, rejected } = filterQualitativeOverrides({
      business_description: "A great company",
      dscr: "1.24x",
      use_of_proceeds: "Working capital",
      revenue: 1200000,
      principal_bio_ceo: "20 years experience",
    });

    assert.equal(Object.keys(accepted).length, 3);
    assert.ok("business_description" in accepted);
    assert.ok("use_of_proceeds" in accepted);
    assert.ok("principal_bio_ceo" in accepted);

    assert.equal(rejected.length, 2);
    assert.ok(rejected.includes("dscr"));
    assert.ok(rejected.includes("revenue"));
  });

  it("returns empty accepted for all-numeric payload", () => {
    const { accepted, rejected } = filterQualitativeOverrides({
      dscr: "1.5",
      ltv: "0.65",
      ebitda: 500000,
    });
    assert.equal(Object.keys(accepted).length, 0);
    assert.equal(rejected.length, 3);
  });

  it("deterministic", () => {
    const input = { business_description: "test", dscr: "1.5" };
    const r1 = filterQualitativeOverrides(input);
    const r2 = filterQualitativeOverrides(input);
    assert.deepEqual(r1, r2);
  });
});

// ─── Track A: Pure file guard ─────────────────────────────────────────────────

describe("Override policy — pure file guard", () => {
  it("overridePolicy.ts has no DB imports", () => {
    const content = fs.readFileSync(
      path.resolve(__dirname, "../overridePolicy.ts"),
      "utf-8",
    );
    assert.ok(!content.includes("supabaseAdmin"));
    assert.ok(!content.includes("server-only"));
  });

  it("overridePolicy.ts has no Math.random", () => {
    const content = fs.readFileSync(
      path.resolve(__dirname, "../overridePolicy.ts"),
      "utf-8",
    );
    assert.ok(!content.includes("Math.random"));
  });

  it("has at least 20 permitted override keys", () => {
    assert.ok(PERMITTED_OVERRIDE_KEYS.size >= 20);
  });
});

// ─── Track B: Event emitter guard ─────────────────────────────────────────────

describe("emitBuddyEvent — structural guard", () => {
  it("exists and uses deal_pipeline_ledger", () => {
    const content = fs.readFileSync(
      path.resolve(__dirname, "../../pipeline/emitPipelineLedgerEvent.ts"),
      "utf-8",
    );
    assert.ok(content.includes("deal_pipeline_ledger"));
    assert.ok(content.includes("emitPipelineLedgerEvent") || content.includes("emitBuddyEvent"));
  });

  it("is non-blocking (catches errors)", () => {
    const content = fs.readFileSync(
      path.resolve(__dirname, "../../pipeline/emitPipelineLedgerEvent.ts"),
      "utf-8",
    );
    assert.ok(content.includes("catch") || content.includes("console.warn"));
  });

  it("includes duration_ms in payload", () => {
    const content = fs.readFileSync(
      path.resolve(__dirname, "../../pipeline/emitPipelineLedgerEvent.ts"),
      "utf-8",
    );
    assert.ok(content.includes("duration_ms"));
  });

  it("emitStructuredLog exists", () => {
    const content = fs.readFileSync(
      path.resolve(__dirname, "../../pipeline/emitPipelineLedgerEvent.ts"),
      "utf-8",
    );
    assert.ok(content.includes("emitStructuredLog"));
    assert.ok(content.includes("buddy_counter"));
  });
});

// ─── Track C: V2 verifier guard ───────────────────────────────────────────────

describe("V2 operating state verifier — structural guard", () => {
  it("exists and is read-only", () => {
    const content = fs.readFileSync(
      path.resolve(__dirname, "../../modelEngine/verifyV2OperatingState.ts"),
      "utf-8",
    );
    assert.ok(content.includes("verifyV2OperatingState"));
    // Must be read-only — no .insert, .update, .delete
    assert.ok(!content.includes(".insert("));
    assert.ok(!content.includes(".update("));
    assert.ok(!content.includes(".delete("));
  });

  it("checks env flags", () => {
    const content = fs.readFileSync(
      path.resolve(__dirname, "../../modelEngine/verifyV2OperatingState.ts"),
      "utf-8",
    );
    assert.ok(content.includes("MODEL_ENGINE_PRIMARY"));
    assert.ok(content.includes("SHADOW_COMPARE"));
  });

  it("checks metric_definitions", () => {
    const content = fs.readFileSync(
      path.resolve(__dirname, "../../modelEngine/verifyV2OperatingState.ts"),
      "utf-8",
    );
    assert.ok(content.includes("metric_definitions"));
  });

  it("checks deal_model_snapshots", () => {
    const content = fs.readFileSync(
      path.resolve(__dirname, "../../modelEngine/verifyV2OperatingState.ts"),
      "utf-8",
    );
    assert.ok(content.includes("deal_model_snapshots"));
  });
});
