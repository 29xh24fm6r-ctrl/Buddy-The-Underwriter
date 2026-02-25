/**
 * H1-H2: Shadow Mode + Canary Rollout Guard Tests
 *
 * CI guards for:
 * - H1: Shadow mode doesn't use structured assist results
 * - H2: Canary mode only allows specified deals/banks
 * - Active mode always allows
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  getStructuredAssistMode,
  isCanaryAllowed,
  shouldUseStructuredAssistResults,
  shouldRunStructuredAssist,
} from "../shadowMode";

// ── Helpers ──────────────────────────────────────────────────────────

const ENV_KEYS = [
  "STRUCTURED_ASSIST_MODE",
  "CANARY_DEAL_IDS",
  "CANARY_BANK_IDS",
  "CANARY_INTERNAL_ONLY",
];

function saveEnv(): Record<string, string | undefined> {
  const saved: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
  }
  return saved;
}

function restoreEnv(saved: Record<string, string | undefined>): void {
  for (const [key, val] of Object.entries(saved)) {
    if (val === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = val;
    }
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe("H1: Shadow Mode", () => {
  let saved: Record<string, string | undefined>;
  beforeEach(() => { saved = saveEnv(); });
  afterEach(() => { restoreEnv(saved); });

  it("defaults to 'active' mode", () => {
    delete process.env.STRUCTURED_ASSIST_MODE;
    assert.equal(getStructuredAssistMode(), "active");
  });

  it("respects STRUCTURED_ASSIST_MODE=shadow", () => {
    process.env.STRUCTURED_ASSIST_MODE = "shadow";
    assert.equal(getStructuredAssistMode(), "shadow");
  });

  it("shadow mode → shouldUseStructuredAssistResults returns false", () => {
    process.env.STRUCTURED_ASSIST_MODE = "shadow";
    assert.equal(
      shouldUseStructuredAssistResults({ dealId: "x", bankId: "y" }),
      false,
    );
  });

  it("shadow mode → shouldRunStructuredAssist still returns true", () => {
    process.env.STRUCTURED_ASSIST_MODE = "shadow";
    assert.equal(shouldRunStructuredAssist(), true);
  });

  it("invalid mode falls back to 'active'", () => {
    process.env.STRUCTURED_ASSIST_MODE = "INVALID";
    assert.equal(getStructuredAssistMode(), "active");
  });
});

describe("H2: Canary Rollout", () => {
  let saved: Record<string, string | undefined>;
  beforeEach(() => { saved = saveEnv(); });
  afterEach(() => { restoreEnv(saved); });

  it("canary mode with CANARY_DEAL_IDS allows listed deals", () => {
    process.env.STRUCTURED_ASSIST_MODE = "canary";
    process.env.CANARY_DEAL_IDS = "deal-1, deal-2";

    assert.equal(
      isCanaryAllowed({ dealId: "deal-1", bankId: "bank-x" }),
      true,
    );
    assert.equal(
      isCanaryAllowed({ dealId: "deal-3", bankId: "bank-x" }),
      false,
    );
  });

  it("canary mode with CANARY_BANK_IDS allows listed banks", () => {
    process.env.STRUCTURED_ASSIST_MODE = "canary";
    process.env.CANARY_BANK_IDS = "bank-a";

    assert.equal(
      isCanaryAllowed({ dealId: "any", bankId: "bank-a" }),
      true,
    );
    assert.equal(
      isCanaryAllowed({ dealId: "any", bankId: "bank-b" }),
      false,
    );
  });

  it("canary mode with CANARY_INTERNAL_ONLY=true allows internal deals", () => {
    process.env.STRUCTURED_ASSIST_MODE = "canary";
    process.env.CANARY_INTERNAL_ONLY = "true";

    assert.equal(
      isCanaryAllowed({ dealId: "any", bankId: "any", isInternal: true }),
      true,
    );
    assert.equal(
      isCanaryAllowed({ dealId: "any", bankId: "any", isInternal: false }),
      false,
    );
  });

  it("active mode → isCanaryAllowed always true", () => {
    process.env.STRUCTURED_ASSIST_MODE = "active";
    assert.equal(
      isCanaryAllowed({ dealId: "any", bankId: "any" }),
      true,
    );
  });

  it("canary mode → shouldUseStructuredAssistResults follows canary rules", () => {
    process.env.STRUCTURED_ASSIST_MODE = "canary";
    process.env.CANARY_DEAL_IDS = "deal-1";

    assert.equal(
      shouldUseStructuredAssistResults({ dealId: "deal-1", bankId: "any" }),
      true,
    );
    assert.equal(
      shouldUseStructuredAssistResults({ dealId: "deal-2", bankId: "any" }),
      false,
    );
  });
});
