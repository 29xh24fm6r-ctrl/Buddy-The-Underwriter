/**
 * SPEC-OWNERSHIP-ENGINE-SCHEMA-RECONCILIATION-1 — Schema guard (2026-05-18)
 *
 * Proves engine.ts owner_requirements upsert matches the actual DB schema:
 *   - Uses threshold_basis + status_json (not rule_version / derived_from_json / status)
 *   - Bridges to deal_ownership_entities for the FK target
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ENGINE_SRC = readFileSync(
  resolve(__dirname, "../engine.ts"),
  "utf-8",
);

describe("ownership engine schema guard", () => {
  test("does NOT reference 'rule_version' column", () => {
    assert.ok(
      !ENGINE_SRC.includes("rule_version"),
      "engine.ts must not write the non-existent 'rule_version' column on owner_requirements",
    );
  });

  test("does NOT reference 'derived_from_json' as a top-level column", () => {
    // derived_from may appear inside status_json.derived_from — that's fine.
    // We guard against it being a direct column key in an upsert.
    const lines = ENGINE_SRC.split("\n");
    const badLine = lines.find(
      (l) => /derived_from_json\s*:/.test(l) && !l.trim().startsWith("//"),
    );
    assert.ok(
      !badLine,
      `engine.ts must not write the non-existent 'derived_from_json' column. Found: ${badLine}`,
    );
  });

  test("upsert to owner_requirements uses 'threshold_basis' column", () => {
    assert.ok(
      ENGINE_SRC.includes("threshold_basis"),
      "engine.ts must include threshold_basis in owner_requirements upsert",
    );
  });

  test("upsert to owner_requirements uses 'status_json' column", () => {
    assert.ok(
      ENGINE_SRC.includes("status_json"),
      "engine.ts must use status_json (not status) in owner_requirements upsert",
    );
  });

  test("bridges to deal_ownership_entities for owner_requirements FK", () => {
    assert.ok(
      ENGINE_SRC.includes("deal_ownership_entities"),
      "engine.ts must bridge to deal_ownership_entities before writing owner_requirements",
    );
  });
});
