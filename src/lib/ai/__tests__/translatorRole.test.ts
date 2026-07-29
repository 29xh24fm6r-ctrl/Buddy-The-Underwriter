/**
 * SPEC-M3 GLASS-BOX-1 — translator role config + vendorApproval test-seam.
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getRoleConfig } from "../roleConfig";
import { VENDOR_NPI_APPROVAL, __setVendorApprovalForTests, __resetVendorApprovalForTests } from "../vendorApproval";

afterEach(() => {
  __resetVendorApprovalForTests();
});

describe("translator role", () => {
  it("defaults to anthropic, same as verifier", () => {
    const config = getRoleConfig("translator");
    assert.equal(config.chain.length, 1);
    assert.equal(config.chain[0].provider, "anthropic");
  });

  it("has its own daily token budget, independent of verifier's", () => {
    const config = getRoleConfig("translator");
    assert.ok(config.dailyTokenBudget > 0);
  });

  it("is overridable via AI_GATEWAY_CHAIN_TRANSLATOR", () => {
    process.env.AI_GATEWAY_CHAIN_TRANSLATOR = "openai:gpt-4o-mini";
    try {
      const config = getRoleConfig("translator");
      assert.equal(config.chain[0].provider, "openai");
      assert.equal(config.chain[0].model, "gpt-4o-mini");
    } finally {
      delete process.env.AI_GATEWAY_CHAIN_TRANSLATOR;
    }
  });
});

describe("VENDOR_NPI_APPROVAL test seam", () => {
  it("defaults anthropic to PENDING", () => {
    assert.equal(VENDOR_NPI_APPROVAL.anthropic, "PENDING");
  });

  it("__setVendorApprovalForTests flips a provider, __reset restores it", () => {
    __setVendorApprovalForTests("anthropic", "APPROVED");
    assert.equal(VENDOR_NPI_APPROVAL.anthropic, "APPROVED");
    __resetVendorApprovalForTests();
    assert.equal(VENDOR_NPI_APPROVAL.anthropic, "PENDING");
  });
});
