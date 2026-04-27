import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SOP_VERSION,
  SOP_EFFECTIVE_DATE,
  PROCEDURAL_NOTICES,
  SOP_RULES,
} from "@/lib/sba/sopRules";

test("sopRules: SOP_VERSION reflects SOP 50 10 8", () => {
  assert.equal(SOP_VERSION, "SOP_50_10_8");
  assert.equal(SOP_EFFECTIVE_DATE, "2025-06-01");
});

test("sopRules: both March 2026 procedural notices present with correct numbers", () => {
  assert.equal(PROCEDURAL_NOTICES.SBSS_SUNSET.notice_number, "5000-875701");
  assert.equal(PROCEDURAL_NOTICES.SBSS_SUNSET.effective_date, "2026-03-01");
  assert.equal(
    PROCEDURAL_NOTICES.CITIZENSHIP_RESIDENCY.notice_number,
    "5000-876626",
  );
  assert.equal(
    PROCEDURAL_NOTICES.CITIZENSHIP_RESIDENCY.effective_date,
    "2026-03-01",
  );
});

test("sopRules: franchise certification deadline is 2026-06-30", () => {
  assert.equal(
    PROCEDURAL_NOTICES.FRANCHISE_CERTIFICATION_DEADLINE.deadline,
    "2026-06-30",
  );
});

test("sopRules: every SOP_RULES citation references SOP 50 10 8 or a procedural notice", () => {
  const pattern = /SOP 50 10 8|Procedural Notice/;
  for (const [key, rule] of Object.entries(SOP_RULES)) {
    assert.match(
      rule.citation,
      pattern,
      `SOP_RULES.${key}.citation must reference SOP 50 10 8 or a procedural notice (got: ${rule.citation})`,
    );
  }
});
