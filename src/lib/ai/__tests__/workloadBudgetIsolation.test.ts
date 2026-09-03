import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { getRoleConfig } from "../roleConfig";

describe("high-volume AI workload budget isolation", () => {
  it("keeps extraction and research out of the shared generator pool", () => {
    const generator = getRoleConfig("generator");
    const extractor = getRoleConfig("extractor");
    const research = getRoleConfig("research");

    assert.notEqual(extractor, generator);
    assert.notEqual(research, generator);
    assert.ok(extractor.dailyTokenBudget > 0);
    assert.ok(research.dailyTokenBudget > 0);
    assert.ok(research.dailyTokenBudget < generator.dailyTokenBudget);
  });

  it("uses Gemini-only chains so provider fallback cannot multiply PDF or grounded calls", () => {
    for (const role of ["extractor", "research"] as const) {
      const config = getRoleConfig(role);
      assert.equal(config.chain.length, 1);
      assert.equal(config.chain[0]?.provider, "google");
    }
  });
});
