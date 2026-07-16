import { test } from "node:test";
import assert from "node:assert/strict";
import { isMockVendorsEnabled } from "@/lib/testMode/mockVendors";

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("isMockVendorsEnabled: false when BUDDY_MOCK_VENDORS is unset", () => {
  withEnv({ BUDDY_MOCK_VENDORS: undefined, NODE_ENV: "development" }, () => {
    assert.equal(isMockVendorsEnabled(), false);
  });
});

test("isMockVendorsEnabled: false when BUDDY_MOCK_VENDORS is set but NODE_ENV is production", () => {
  withEnv({ BUDDY_MOCK_VENDORS: "true", NODE_ENV: "production" }, () => {
    assert.equal(isMockVendorsEnabled(), false);
  });
});

test("isMockVendorsEnabled: false when NODE_ENV is not production but the flag isn't exactly \"true\"", () => {
  withEnv({ BUDDY_MOCK_VENDORS: "1", NODE_ENV: "development" }, () => {
    assert.equal(isMockVendorsEnabled(), false);
  });
});

test("isMockVendorsEnabled: true only when both the flag is \"true\" and NODE_ENV is not production", () => {
  withEnv({ BUDDY_MOCK_VENDORS: "true", NODE_ENV: "test" }, () => {
    assert.equal(isMockVendorsEnabled(), true);
  });
});
