import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);
const { buildAICommissioningReadiness } = require("../commissioningReadiness") as typeof import("../commissioningReadiness");
const {
  __setVendorApprovalForTests,
  __resetVendorApprovalForTests,
} = require("../vendorApproval") as typeof import("../vendorApproval");

afterEach(() => {
  __resetVendorApprovalForTests();
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
});

test("three-provider readiness requires credentials, NPI approval, and live success evidence", () => {
  process.env.GEMINI_API_KEY = "configured";
  process.env.OPENAI_API_KEY = "configured";
  process.env.ANTHROPIC_API_KEY = "configured";
  __setVendorApprovalForTests("google", "APPROVED");
  __setVendorApprovalForTests("openai", "APPROVED");
  __setVendorApprovalForTests("anthropic", "APPROVED");

  const report = buildAICommissioningReadiness([
    { provider: "google", outcome: "success", created_at: "2026-08-17T10:00:00Z" },
    { provider: "openai", outcome: "success", created_at: "2026-08-17T10:01:00Z" },
    { provider: "anthropic", outcome: "failure", created_at: "2026-08-17T10:02:00Z" },
  ]);

  assert.equal(report.fullyCommissioned, false);
  assert.equal(report.providers.find((provider) => provider.provider === "anthropic")?.commissioned, false);
});

test("reports commissioned only after every approved provider has successful evidence", () => {
  process.env.GEMINI_API_KEY = "configured";
  process.env.OPENAI_API_KEY = "configured";
  process.env.ANTHROPIC_API_KEY = "configured";
  for (const provider of ["google", "openai", "anthropic"] as const) {
    __setVendorApprovalForTests(provider, "APPROVED");
  }

  const report = buildAICommissioningReadiness(
    ["google", "openai", "anthropic"].map((provider, index) => ({
      provider,
      outcome: "success",
      created_at: `2026-08-17T10:0${index}:00Z`,
    })),
  );

  assert.equal(report.fullyCommissioned, true);
  assert.ok(report.providers.every((provider) => provider.commissioned));
});
