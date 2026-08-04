/**
 * Unit tests for testRunId generation and isolation helpers.
 *
 * SPEC-BORROWER-QA-IDENTITY-V1 §2, §9
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const { generateTestRunId } = require("../testRunId") as typeof import("../testRunId");
const { isTestDealFilter } = require("../isolation") as typeof import("../isolation");

test("generateTestRunId produces correct format E2E-YYYYMMDD-HHMMSS-<6 hex>", () => {
  const id = generateTestRunId();

  const regex = /^E2E-\d{8}-\d{6}-[0-9a-f]{6}$/;
  assert.match(
    id,
    regex,
    `test_run_id "${id}" should match E2E-YYYYMMDD-HHMMSS-<hex>`,
  );

  const parts = id.split("-");
  assert.equal(parts.length, 4);

  // Verify date part: YYYYMMDD
  assert.equal(parts[1].length, 8);
  const year = Number.parseInt(parts[1].slice(0, 4), 10);
  assert.ok(year >= 2026 && year <= 2100);

  // Verify time part: HHMMSS
  assert.equal(parts[2].length, 6);

  // Verify random part: 6 hex chars
  const randomPart = parts[3];
  assert.equal(randomPart.length, 6);
  assert.match(randomPart, /^[0-9a-f]{6}$/);
});

test("generateTestRunId produces unique values", () => {
  const ids = new Set<string>();

  for (let i = 0; i < 100; i++) {
    const id = generateTestRunId();
    assert.equal(ids.has(id), false, `test_run_id "${id}" should be unique`);
    ids.add(id);
  }
});

test("isTestDealFilter returns correct filter shape", () => {
  const filter = isTestDealFilter();

  assert.equal(filter.column, "is_test");
  assert.equal(filter.value, false);
});
