import { test } from "node:test";
import assert from "node:assert/strict";

import { maskEin, inferEntityTypeFromText } from "@/lib/borrower/extractBorrowerFromDocs";
import { sumOwnershipPercentage, ownershipCoverageStatus } from "@/lib/principals/extractPrincipalsFromDocs";

test("maskEin masks to last4", () => {
  assert.equal(maskEin("12-3456789"), "XX-XXX6789");
  assert.equal(maskEin("123456789"), "XX-XXX6789");
  assert.equal(maskEin("6789"), "XX-XXX6789");
  assert.equal(maskEin("12"), null);
});

test("inferEntityTypeFromText maps tax forms", () => {
  assert.equal(inferEntityTypeFromText("Form 1120S - U.S. Income Tax Return"), "S-Corp");
  assert.equal(inferEntityTypeFromText("Form 1120 - U.S. Corporation"), "Corp");
  assert.equal(inferEntityTypeFromText("Form 1065 - Partnership Return"), "Partnership");
  assert.equal(inferEntityTypeFromText("Schedule C (Form 1040)"), "Sole Prop");
});

test("ownership summation and coverage", () => {
  const total = sumOwnershipPercentage([
    { ownershipPercentage: 55 },
    { ownershipPercentage: 25 },
    { ownershipPercentage: 20 },
  ]);
  assert.equal(total, 100);
  assert.equal(ownershipCoverageStatus(total), "ok");

  const low = sumOwnershipPercentage([{ ownershipPercentage: 40 }]);
  assert.equal(ownershipCoverageStatus(low), "low");
});
