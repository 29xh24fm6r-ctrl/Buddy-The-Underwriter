/**
 * Regression guards for SignWell's non-draft document contract and Buddy's
 * IAL2 signer binding. These are source guards because client.ts deliberately
 * imports "server-only" and owns the final provider payload.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const clientSource = readFileSync(join(ROOT, "src/lib/esign/signwell/client.ts"), "utf-8");

describe("SignWell initiation contract", () => {
  it("adds SignWell's required signature page when no placed fields exist", () => {
    assert.match(clientSource, /const fields = args\.fields \?\? \[\[\]\]/);
    assert.match(clientSource, /const hasPlacedFields = fields\.some/);
    assert.match(clientSource, /with_signature_page:\s*!hasPlacedFields/);
  });

  it("keeps explicit placed fields and does not force an extra signature page", () => {
    assert.match(clientSource, /fields,\s*\n\s*\/\/ SignWell rejects/);
    assert.doesNotMatch(clientSource, /fields:\s*args\.fields \?\? \[\[\]\]/);
  });

  it("disables recipient reassignment to preserve the IAL2 signer binding", () => {
    assert.match(clientSource, /allow_reassign:\s*false/);
  });
});
