/**
 * Tests for the centralized Model Engine V2 mode selector.
 *
 * Tests env var priority, allowlists, and convenience helpers.
 * Each test saves/restores env vars to avoid pollution.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  selectModelEngineMode,
  isV2Enabled,
  isV2Primary,
  isV1RendererDisabled,
  _resetAllowlistCache,
} from "../modeSelector";

// ---------------------------------------------------------------------------
// Env var save/restore helpers
// ---------------------------------------------------------------------------

const ENV_KEYS = [
  "MODEL_ENGINE_MODE",
  "USE_MODEL_ENGINE_V2",
  "V2_PRIMARY_DEAL_ALLOWLIST",
  "V2_PRIMARY_BANK_ALLOWLIST",
  "V1_RENDERER_DISABLED",
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
  _resetAllowlistCache();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("selectModelEngineMode", () => {
  beforeEach(() => {
    saveEnv();
    clearEnv();
  });

  afterEach(() => {
    restoreEnv();
  });

  it("default (no env vars) → v1", () => {
    const r = selectModelEngineMode();
    assert.equal(r.mode, "v1");
    assert.equal(r.reason, "default");
  });

  it("USE_MODEL_ENGINE_V2=true → v2_shadow", () => {
    process.env.USE_MODEL_ENGINE_V2 = "true";
    const r = selectModelEngineMode();
    assert.equal(r.mode, "v2_shadow");
    assert.match(r.reason, /USE_MODEL_ENGINE_V2/);
  });

  it("MODEL_ENGINE_MODE=v2_primary → v2_primary", () => {
    process.env.MODEL_ENGINE_MODE = "v2_primary";
    const r = selectModelEngineMode();
    assert.equal(r.mode, "v2_primary");
    assert.match(r.reason, /MODEL_ENGINE_MODE=v2_primary/);
  });

  it("MODEL_ENGINE_MODE=v1 overrides USE_MODEL_ENGINE_V2=true", () => {
    process.env.USE_MODEL_ENGINE_V2 = "true";
    process.env.MODEL_ENGINE_MODE = "v1";
    const r = selectModelEngineMode();
    assert.equal(r.mode, "v1");
    assert.match(r.reason, /MODEL_ENGINE_MODE=v1/);
  });

  it("MODEL_ENGINE_MODE=v2_shadow → v2_shadow", () => {
    process.env.MODEL_ENGINE_MODE = "v2_shadow";
    const r = selectModelEngineMode();
    assert.equal(r.mode, "v2_shadow");
  });

  it("invalid MODEL_ENGINE_MODE falls through to other checks", () => {
    process.env.MODEL_ENGINE_MODE = "invalid_mode";
    process.env.USE_MODEL_ENGINE_V2 = "true";
    const r = selectModelEngineMode();
    assert.equal(r.mode, "v2_shadow");
  });

  it("deal allowlist → v2_primary for listed deal", () => {
    process.env.USE_MODEL_ENGINE_V2 = "true";
    process.env.V2_PRIMARY_DEAL_ALLOWLIST = "deal-aaa,deal-bbb";
    const r = selectModelEngineMode({ dealId: "deal-bbb" });
    assert.equal(r.mode, "v2_primary");
    assert.match(r.reason, /deal_allowlist/);
  });

  it("deal allowlist → v2_shadow for unlisted deal", () => {
    process.env.USE_MODEL_ENGINE_V2 = "true";
    process.env.V2_PRIMARY_DEAL_ALLOWLIST = "deal-aaa,deal-bbb";
    const r = selectModelEngineMode({ dealId: "deal-ccc" });
    assert.equal(r.mode, "v2_shadow");
  });

  it("bank allowlist → v2_primary for listed bank", () => {
    process.env.USE_MODEL_ENGINE_V2 = "true";
    process.env.V2_PRIMARY_BANK_ALLOWLIST = "bank-111,bank-222";
    const r = selectModelEngineMode({ bankId: "bank-222" });
    assert.equal(r.mode, "v2_primary");
    assert.match(r.reason, /bank_allowlist/);
  });

  it("deal allowlist takes priority over bank allowlist", () => {
    process.env.USE_MODEL_ENGINE_V2 = "true";
    process.env.V2_PRIMARY_DEAL_ALLOWLIST = "deal-aaa";
    process.env.V2_PRIMARY_BANK_ALLOWLIST = "bank-111";
    // Deal is in allowlist, bank is also in allowlist
    const r = selectModelEngineMode({ dealId: "deal-aaa", bankId: "bank-111" });
    assert.equal(r.mode, "v2_primary");
    assert.match(r.reason, /deal_allowlist/);
  });

  it("explicit mode overrides allowlists", () => {
    process.env.MODEL_ENGINE_MODE = "v2_shadow";
    process.env.V2_PRIMARY_DEAL_ALLOWLIST = "deal-aaa";
    const r = selectModelEngineMode({ dealId: "deal-aaa" });
    assert.equal(r.mode, "v2_shadow");
    assert.match(r.reason, /MODEL_ENGINE_MODE/);
  });

  it("no context → allowlists have no effect", () => {
    process.env.USE_MODEL_ENGINE_V2 = "true";
    process.env.V2_PRIMARY_DEAL_ALLOWLIST = "deal-aaa";
    const r = selectModelEngineMode();
    assert.equal(r.mode, "v2_shadow");
  });
});

describe("isV2Enabled", () => {
  beforeEach(() => {
    saveEnv();
    clearEnv();
  });

  afterEach(() => {
    restoreEnv();
  });

  it("returns false when mode is v1", () => {
    assert.equal(isV2Enabled(), false);
  });

  it("returns true when mode is v2_shadow", () => {
    process.env.USE_MODEL_ENGINE_V2 = "true";
    assert.equal(isV2Enabled(), true);
  });

  it("returns true when mode is v2_primary", () => {
    process.env.MODEL_ENGINE_MODE = "v2_primary";
    assert.equal(isV2Enabled(), true);
  });
});

describe("isV2Primary", () => {
  beforeEach(() => {
    saveEnv();
    clearEnv();
  });

  afterEach(() => {
    restoreEnv();
  });

  it("returns false when mode is v1", () => {
    assert.equal(isV2Primary(), false);
  });

  it("returns false when mode is v2_shadow", () => {
    process.env.USE_MODEL_ENGINE_V2 = "true";
    assert.equal(isV2Primary(), false);
  });

  it("returns true when mode is v2_primary", () => {
    process.env.MODEL_ENGINE_MODE = "v2_primary";
    assert.equal(isV2Primary(), true);
  });
});

describe("isV1RendererDisabled", () => {
  beforeEach(() => {
    saveEnv();
    clearEnv();
  });

  afterEach(() => {
    restoreEnv();
  });

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

  it("guard pattern: v1 mode + disabled → would block", () => {
    process.env.V1_RENDERER_DISABLED = "true";
    const { mode } = selectModelEngineMode();
    assert.equal(mode, "v1");
    // Simulate the route guard condition (cast avoids TS narrowing after assert)
    const shouldBlock = isV1RendererDisabled() && (mode as string) !== "v2_primary";
    assert.equal(shouldBlock, true);
  });

  it("guard pattern: v2_primary + disabled → allowed", () => {
    process.env.V1_RENDERER_DISABLED = "true";
    process.env.MODEL_ENGINE_MODE = "v2_primary";
    const { mode } = selectModelEngineMode();
    assert.equal(mode, "v2_primary");
    const shouldBlock = isV1RendererDisabled() && (mode as string) !== "v2_primary";
    assert.equal(shouldBlock, false);
  });

  it("guard pattern: v2_shadow + disabled → would block", () => {
    process.env.V1_RENDERER_DISABLED = "true";
    process.env.USE_MODEL_ENGINE_V2 = "true";
    const { mode } = selectModelEngineMode();
    assert.equal(mode, "v2_shadow");
    const shouldBlock = isV1RendererDisabled() && (mode as string) !== "v2_primary";
    assert.equal(shouldBlock, true);
  });
});
