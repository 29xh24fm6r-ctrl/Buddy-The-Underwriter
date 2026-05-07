// SPEC-13.5 A-2 / A-6 — guard tests for `trustedBankId` on
// upsertManagementProfile, INCLUDING the deleteManagementProfile carve-out.
// Per Risk #2, deletes must NEVER accept trustedBankId — the comment on the
// delete function is the load-bearing artifact preventing a future "complete
// the symmetry" mistake.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const SRC_PATH = path.join(
  process.cwd(),
  "src/lib/creditMemo/inputs/upsertManagementProfile.ts",
);
const SRC = fs.readFileSync(SRC_PATH, "utf-8");

test("[upsertManagementProfile.trustedBankId-1] upsert type accepts optional trustedBankId", () => {
  assert.match(SRC, /trustedBankId\?\s*:\s*string/);
});

test("[upsertManagementProfile.trustedBankId-2] security comment is unambiguous", () => {
  assert.ok(SRC.includes("INTERNAL ONLY"));
  assert.ok(SRC.includes("NEVER expose this parameter via an API route"));
  assert.ok(SRC.includes("tenant-isolation bypass"));
});

test("[upsertManagementProfile.trustedBankId-3] upsert function gates auth check on trustedBankId", () => {
  // The bankId resolution must branch on args.trustedBankId.
  assert.match(SRC, /if\s*\(\s*args\.trustedBankId\s*\)/);
});

test("[upsertManagementProfile.trustedBankId-4] deleteManagementProfile signature does NOT accept trustedBankId", () => {
  // Match the inline arg shape on the delete function.
  const deleteSigMatch = SRC.match(
    /export async function deleteManagementProfile\(args:\s*\{([^}]+)\}/,
  );
  assert.ok(
    deleteSigMatch,
    "deleteManagementProfile must have its inline arg signature",
  );
  assert.ok(
    !deleteSigMatch[1].includes("trustedBankId"),
    "deleteManagementProfile signature must not include trustedBankId — see spec Risk #2",
  );
});

test("[upsertManagementProfile.trustedBankId-5] delete carve-out comment references the spec reasoning", () => {
  // Future devs must see WHY the symmetry is broken on purpose.
  const idx = SRC.indexOf("export async function deleteManagementProfile");
  assert.ok(idx > 0, "deleteManagementProfile must exist");
  const before = SRC.slice(Math.max(0, idx - 800), idx);
  assert.ok(
    /SPEC-13\.5/.test(before),
    "comment immediately before delete function must reference SPEC-13.5",
  );
  assert.ok(
    /Risk #2/.test(before),
    "comment must reference Risk #2 (tenant-isolation reasoning)",
  );
  assert.ok(
    /trustedBankId/.test(before),
    "comment must mention the trustedBankId carve-out by name",
  );
});

test("[upsertManagementProfile.trustedBankId-6] delete function still calls ensureDealBankAccess unconditionally", () => {
  // The carve-out is only meaningful if the unconditional auth check stays.
  const idx = SRC.indexOf("export async function deleteManagementProfile");
  const block = SRC.slice(idx, idx + 1500);
  assert.match(block, /ensureDealBankAccess\(args\.dealId\)/);
  assert.ok(
    !block.split("ensureDealBankAccess")[0].includes("if"),
    "ensureDealBankAccess in delete must not be gated by any conditional",
  );
});
