/**
 * Unit tests for UUID v7 generator.
 *
 * Run: npx tsx src/lib/uuid/__tests__/v7.test.ts
 */

import { uuidv7 } from "../v7";
import assert from "node:assert/strict";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
  } catch (e: any) {
    console.error(`  \u2717 ${name}`);
    console.error(`    ${e.message}`);
    process.exitCode = 1;
  }
}

console.log("uuidv7");

test("returns a valid UUID format", () => {
  const id = uuidv7();
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  assert.ok(re.test(id), `Invalid format: ${id}`);
});

test("version nibble is 7", () => {
  const id = uuidv7();
  // Version is the 13th hex character (index 14 in the string with dashes)
  // Format: xxxxxxxx-xxxx-Vxxx-yxxx-xxxxxxxxxxxx
  const versionChar = id[14];
  assert.equal(versionChar, "7", `Version should be 7, got ${versionChar}`);
});

test("variant bits are 10xx", () => {
  const id = uuidv7();
  // Variant is the 17th hex character (index 19 in the string with dashes)
  // Format: xxxxxxxx-xxxx-xxxx-Vxxx-xxxxxxxxxxxx
  const variantChar = parseInt(id[19], 16);
  assert.ok(variantChar >= 0x8 && variantChar <= 0xb,
    `Variant should be 8-b (10xx), got 0x${variantChar.toString(16)}`);
});

test("generates unique IDs", () => {
  const ids = new Set<string>();
  for (let i = 0; i < 1000; i++) {
    ids.add(uuidv7());
  }
  assert.equal(ids.size, 1000, "All 1000 IDs should be unique");
});

test("timestamp portion is non-decreasing across calls", () => {
  const timestamps: number[] = [];
  for (let i = 0; i < 10; i++) {
    const id = uuidv7();
    const hex = id.replace(/-/g, "").slice(0, 12);
    timestamps.push(parseInt(hex, 16));
  }
  // Timestamp portion (first 48 bits) must be non-decreasing
  for (let i = 1; i < timestamps.length; i++) {
    assert.ok(
      timestamps[i] >= timestamps[i - 1],
      `Timestamps should be non-decreasing: ${timestamps[i - 1]} then ${timestamps[i]}`,
    );
  }
});

test("timestamp is embedded in the first 48 bits", () => {
  const before = Date.now();
  const id = uuidv7();
  const after = Date.now();

  // Extract timestamp from UUID: first 12 hex chars (48 bits)
  const hex = id.replace(/-/g, "").slice(0, 12);
  const ts = parseInt(hex, 16);

  assert.ok(ts >= before, `Timestamp ${ts} should be >= ${before}`);
  assert.ok(ts <= after, `Timestamp ${ts} should be <= ${after}`);
});

console.log("\nAll tests passed!");
