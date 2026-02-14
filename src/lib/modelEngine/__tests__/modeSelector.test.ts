/**
 * Tests for the centralized Model Engine mode selector.
 *
 * Phase 11: Non-ops contexts are enforced to v2_primary.
 * Env var priority, allowlists, and convenience helpers are
 * only exercised in ops contexts (isOpsOverride: true).
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  selectModelEngineMode,
  isV2Enabled,
  isV2Primary,
  isV1RendererDisabled,
  isShadowCompareEnabled,
  _resetAllowlistCache,
} from "../modeSelector";

// ---------------------------------------------------------------------------
// Env var save/restore helpers
// ---------------------------------------------------------------------------

const ENV_KEYS = [
  "MODEL_ENGINE_PRIMARY",
  "MODEL_ENGINE_MODE",
  "V2_PRIMARY_DEAL_ALLOWLIST",
  "V2_PRIMARY_BANK_ALLOWLIST",
  "V1_RENDERER_DISABLED",
  "SHADOW_COMPARE",
] as const;

let savedEnv: Record<string, string | undefined>;

function saveEnv() {
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
}

function restoreEnv() {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  _resetAllowlistCache();
}

function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
  delete process.env.USE_MODEL_ENGINE_V2;
  _resetAllowlistCache();
}

// ---------------------------------------------------------------------------
// Phase 11 — Non-ops enforcement
// ---------------------------------------------------------------------------

describe("selectModelEngineMode — non-ops enforcement (Phase 11)", () => {
  beforeEach(() => { saveEnv(); clearEnv(); });
  afterEach(() => { restoreEnv(); });

  it("no context → enforced v2_primary", () => {
    const r = selectModelEngineMode();
    assert.equal(r.mode, "v2_primary");
    assert.equal(r.reason, "enforced");
  });

  it("isOpsOverride=false → enforced v2_primary even with MODEL_ENGINE_PRIMARY=V1", () => {
    process.env.MODEL_ENGINE_PRIMARY = "V1";
    const r = selectModelEngineMode({ isOpsOverride: false });
    assert.equal(r.mode, "v2_primary");
    assert.equal(r.reason, "enforced");
  });

  it("bankId + dealId without isOpsOverride → enforced v2_primary", () => {
    process.env.MODEL_ENGINE_MODE = "v1";
    const r = selectModelEngineMode({ bankId: "bank-1", dealId: "deal-1" });
    assert.equal(r.mode, "v2_primary");
    assert.equal(r.reason, "enforced");
  });
});

// ---------------------------------------------------------------------------
// Ops context — full env var priority chain
// ---------------------------------------------------------------------------

describe("selectModelEngineMode — ops context", () => {
  beforeEach(() => { saveEnv(); clearEnv(); });
  afterEach(() => { restoreEnv(); });

  const ops = { isOpsOverride: true } as const;

  it("default (no env vars) → v2_primary", () => {
    const r = selectModelEngineMode(ops);
    assert.equal(r.mode, "v2_primary");
    assert.equal(r.reason, "default");
  });

  it("MODEL_ENGINE_PRIMARY=V1 → v1", () => {
    process.env.MODEL_ENGINE_PRIMARY = "V1";
    const r = selectModelEngineMode(ops);
    assert.equal(r.mode, "v1");
    assert.match(r.reason, /MODEL_ENGINE_PRIMARY=V1/);
  });

  it("MODEL_ENGINE_PRIMARY=V2 → v2_primary", () => {
    process.env.MODEL_ENGINE_PRIMARY = "V2";
    const r = selectModelEngineMode(ops);
    assert.equal(r.mode, "v2_primary");
    assert.match(r.reason, /MODEL_ENGINE_PRIMARY=V2/);
  });

  it("MODEL_ENGINE_PRIMARY overrides MODEL_ENGINE_MODE", () => {
    process.env.MODEL_ENGINE_PRIMARY = "V1";
    process.env.MODEL_ENGINE_MODE = "v2_primary";
    const r = selectModelEngineMode(ops);
    assert.equal(r.mode, "v1");
    assert.match(r.reason, /MODEL_ENGINE_PRIMARY=V1/);
  });

  it("MODEL_ENGINE_MODE=v2_primary → v2_primary", () => {
    process.env.MODEL_ENGINE_MODE = "v2_primary";
    const r = selectModelEngineMode(ops);
    assert.equal(r.mode, "v2_primary");
    assert.match(r.reason, /MODEL_ENGINE_MODE=v2_primary/);
  });

  it("MODEL_ENGINE_MODE=v1 → v1", () => {
    process.env.MODEL_ENGINE_MODE = "v1";
    const r = selectModelEngineMode(ops);
    assert.equal(r.mode, "v1");
    assert.match(r.reason, /MODEL_ENGINE_MODE=v1/);
  });

  it("MODEL_ENGINE_MODE=v2_shadow → v2_shadow", () => {
    process.env.MODEL_ENGINE_MODE = "v2_shadow";
    const r = selectModelEngineMode(ops);
    assert.equal(r.mode, "v2_shadow");
  });

  it("invalid MODEL_ENGINE_MODE falls through to default v2_primary", () => {
    process.env.MODEL_ENGINE_MODE = "invalid_mode";
    const r = selectModelEngineMode(ops);
    assert.equal(r.mode, "v2_primary");
    assert.equal(r.reason, "default");
  });

  it("deal allowlist → v2_primary for listed deal", () => {
    process.env.V2_PRIMARY_DEAL_ALLOWLIST = "deal-aaa,deal-bbb";
    const r = selectModelEngineMode({ ...ops, dealId: "deal-bbb" });
    assert.equal(r.mode, "v2_primary");
    assert.match(r.reason, /deal_allowlist/);
  });

  it("deal allowlist → default v2_primary for unlisted deal", () => {
    process.env.V2_PRIMARY_DEAL_ALLOWLIST = "deal-aaa,deal-bbb";
    const r = selectModelEngineMode({ ...ops, dealId: "deal-ccc" });
    assert.equal(r.mode, "v2_primary");
    assert.equal(r.reason, "default");
  });

  it("bank allowlist → v2_primary for listed bank", () => {
    process.env.V2_PRIMARY_BANK_ALLOWLIST = "bank-111,bank-222";
    const r = selectModelEngineMode({ ...ops, bankId: "bank-222" });
    assert.equal(r.mode, "v2_primary");
    assert.match(r.reason, /bank_allowlist/);
  });

  it("deal allowlist takes priority over bank allowlist", () => {
    process.env.V2_PRIMARY_DEAL_ALLOWLIST = "deal-aaa";
    process.env.V2_PRIMARY_BANK_ALLOWLIST = "bank-111";
    const r = selectModelEngineMode({ ...ops, dealId: "deal-aaa", bankId: "bank-111" });
    assert.equal(r.mode, "v2_primary");
    assert.match(r.reason, /deal_allowlist/);
  });

  it("explicit mode overrides allowlists", () => {
    process.env.MODEL_ENGINE_MODE = "v2_shadow";
    process.env.V2_PRIMARY_DEAL_ALLOWLIST = "deal-aaa";
    const r = selectModelEngineMode({ ...ops, dealId: "deal-aaa" });
    assert.equal(r.mode, "v2_shadow");
    assert.match(r.reason, /MODEL_ENGINE_MODE/);
  });

  it("no context IDs → default v2_primary", () => {
    process.env.V2_PRIMARY_DEAL_ALLOWLIST = "deal-aaa";
    const r = selectModelEngineMode(ops);
    assert.equal(r.mode, "v2_primary");
    assert.equal(r.reason, "default");
  });

  it("MODEL_ENGINE_PRIMARY=V1 forces v1 even with deal in allowlist", () => {
    process.env.MODEL_ENGINE_PRIMARY = "V1";
    process.env.V2_PRIMARY_DEAL_ALLOWLIST = "deal-aaa";
    const r = selectModelEngineMode({ ...ops, dealId: "deal-aaa" });
    assert.equal(r.mode, "v1");
    assert.match(r.reason, /MODEL_ENGINE_PRIMARY=V1/);
  });
});

// ---------------------------------------------------------------------------
// Convenience helpers — non-ops always v2_primary
// ---------------------------------------------------------------------------

describe("isV2Enabled", () => {
  beforeEach(() => { saveEnv(); clearEnv(); });
  afterEach(() => { restoreEnv(); });

  it("returns true by default (enforced v2_primary)", () => {
    assert.equal(isV2Enabled(), true);
  });

  it("returns true even with MODEL_ENGINE_PRIMARY=V1 (non-ops enforced)", () => {
    process.env.MODEL_ENGINE_PRIMARY = "V1";
    assert.equal(isV2Enabled(), true);
  });

  it("returns false when explicitly v1 in ops context", () => {
    process.env.MODEL_ENGINE_PRIMARY = "V1";
    assert.equal(isV2Enabled({ isOpsOverride: true }), false);
  });

  it("returns true when mode is v2_shadow in ops context", () => {
    process.env.MODEL_ENGINE_MODE = "v2_shadow";
    assert.equal(isV2Enabled({ isOpsOverride: true }), true);
  });

  it("returns true when mode is v2_primary in ops context", () => {
    process.env.MODEL_ENGINE_MODE = "v2_primary";
    assert.equal(isV2Enabled({ isOpsOverride: true }), true);
  });
});

describe("isV2Primary", () => {
  beforeEach(() => { saveEnv(); clearEnv(); });
  afterEach(() => { restoreEnv(); });

  it("returns true by default (enforced)", () => {
    assert.equal(isV2Primary(), true);
  });

  it("returns true even with MODEL_ENGINE_PRIMARY=V1 (non-ops enforced)", () => {
    process.env.MODEL_ENGINE_PRIMARY = "V1";
    assert.equal(isV2Primary(), true);
  });

  it("returns false when explicitly v1 in ops context", () => {
    process.env.MODEL_ENGINE_PRIMARY = "V1";
    assert.equal(isV2Primary({ isOpsOverride: true }), false);
  });

  it("returns false when mode is v2_shadow in ops context", () => {
    process.env.MODEL_ENGINE_MODE = "v2_shadow";
    assert.equal(isV2Primary({ isOpsOverride: true }), false);
  });

  it("returns true when mode is v2_primary in ops context", () => {
    process.env.MODEL_ENGINE_MODE = "v2_primary";
    assert.equal(isV2Primary({ isOpsOverride: true }), true);
  });
});

// ---------------------------------------------------------------------------
// Env-based flags (not affected by isOpsOverride)
// ---------------------------------------------------------------------------

describe("isV1RendererDisabled", () => {
  beforeEach(() => { saveEnv(); clearEnv(); });
  afterEach(() => { restoreEnv(); });

  it("returns false when V1_RENDERER_DISABLED is unset", () => {
    assert.equal(isV1RendererDisabled(), false);
  });

  it("returns false when V1_RENDERER_DISABLED=false", () => {
    process.env.V1_RENDERER_DISABLED = "false";
    assert.equal(isV1RendererDisabled(), false);
  });

  it("returns true when V1_RENDERER_DISABLED=true", () => {
    process.env.V1_RENDERER_DISABLED = "true";
    assert.equal(isV1RendererDisabled(), true);
  });

  it("guard pattern (ops): v1 mode + disabled → would block", () => {
    process.env.V1_RENDERER_DISABLED = "true";
    process.env.MODEL_ENGINE_PRIMARY = "V1";
    const { mode } = selectModelEngineMode({ isOpsOverride: true });
    assert.equal(mode, "v1");
    const shouldBlock = isV1RendererDisabled() && (mode as string) !== "v2_primary";
    assert.equal(shouldBlock, true);
  });

  it("guard pattern: v2_primary + disabled → allowed", () => {
    process.env.V1_RENDERER_DISABLED = "true";
    const { mode } = selectModelEngineMode();
    assert.equal(mode, "v2_primary");
    const shouldBlock = isV1RendererDisabled() && (mode as string) !== "v2_primary";
    assert.equal(shouldBlock, false);
  });

  it("guard pattern (ops): v2_shadow + disabled → would block", () => {
    process.env.V1_RENDERER_DISABLED = "true";
    process.env.MODEL_ENGINE_MODE = "v2_shadow";
    const { mode } = selectModelEngineMode({ isOpsOverride: true });
    assert.equal(mode, "v2_shadow");
    const shouldBlock = isV1RendererDisabled() && (mode as string) !== "v2_primary";
    assert.equal(shouldBlock, true);
  });
});

describe("isShadowCompareEnabled", () => {
  beforeEach(() => { saveEnv(); clearEnv(); });
  afterEach(() => { restoreEnv(); });

  it("returns false when SHADOW_COMPARE is unset", () => {
    assert.equal(isShadowCompareEnabled(), false);
  });

  it("returns false when SHADOW_COMPARE=false", () => {
    process.env.SHADOW_COMPARE = "false";
    assert.equal(isShadowCompareEnabled(), false);
  });

  it("returns true when SHADOW_COMPARE=true", () => {
    process.env.SHADOW_COMPARE = "true";
    assert.equal(isShadowCompareEnabled(), true);
  });
});
