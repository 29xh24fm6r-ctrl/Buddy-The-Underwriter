// Guard tests: narrative trust sanitizer is wired into the live persistence
// and rendering paths. Source-pattern guards — no DB, no Clerk.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const UPSERT_SRC = fs.readFileSync(
  path.join(process.cwd(), "src/lib/creditMemo/inputs/upsertBorrowerStory.ts"),
  "utf-8",
);

const MEMO_BUILDER_SRC = fs.readFileSync(
  path.join(process.cwd(), "src/lib/creditMemo/canonical/buildCanonicalCreditMemo.ts"),
  "utf-8",
);

describe("narrative trust wiring guards", () => {
  // ── upsertBorrowerStory (save-time) ──────────────────────────────────

  it("[save-time-1] upsertBorrowerStory imports sanitizeBorrowerStoryPatch", () => {
    assert.ok(
      UPSERT_SRC.includes("sanitizeBorrowerStoryPatch"),
      "upsertBorrowerStory must import sanitizeBorrowerStoryPatch",
    );
  });

  it("[save-time-2] upsertBorrowerStory imports buildMemoPeopleFromRows", () => {
    assert.ok(
      UPSERT_SRC.includes("buildMemoPeopleFromRows"),
      "upsertBorrowerStory must import buildMemoPeopleFromRows to build people registry",
    );
  });

  it("[save-time-3] upsertBorrowerStory loads ownership_entities for the deal", () => {
    assert.ok(
      UPSERT_SRC.includes("ownership_entities"),
      "upsertBorrowerStory must load ownership_entities to build people registry",
    );
  });

  it("[save-time-4] upsertBorrowerStory loads deal_management_profiles for the deal", () => {
    assert.ok(
      UPSERT_SRC.includes("deal_management_profiles"),
      "upsertBorrowerStory must load deal_management_profiles to build people registry",
    );
  });

  it("[save-time-5] upsertBorrowerStory returns narrativeTrustWarnings", () => {
    assert.ok(
      UPSERT_SRC.includes("narrativeTrustWarnings"),
      "upsertBorrowerStory result must include narrativeTrustWarnings",
    );
  });

  // ── buildCanonicalCreditMemo (render-time) ───────────────────────────

  it("[render-time-1] buildCanonicalCreditMemo imports sanitizeMemoBorrowerStory", () => {
    assert.ok(
      MEMO_BUILDER_SRC.includes("sanitizeMemoBorrowerStory"),
      "buildCanonicalCreditMemo must import sanitizeMemoBorrowerStory for render-time trust",
    );
  });

  it("[render-time-2] buildCanonicalCreditMemo applies trust sanitization to business_summary", () => {
    assert.ok(
      MEMO_BUILDER_SRC.includes("trustResult.fields.business_description"),
      "buildCanonicalCreditMemo must apply trust sanitization to business_description",
    );
  });

  it("[render-time-3] buildCanonicalCreditMemo sanitizes key_risks at render time", () => {
    assert.ok(
      MEMO_BUILDER_SRC.includes("trustResult.fields.key_risks"),
      "buildCanonicalCreditMemo must sanitize key_risks at render time",
    );
  });

  it("[render-time-4] buildCanonicalCreditMemo passes ownerEntities to sanitizer", () => {
    // The sanitizer call must include ownerEntities for people registry
    const idx = MEMO_BUILDER_SRC.indexOf("sanitizeMemoBorrowerStory(");
    const block = MEMO_BUILDER_SRC.slice(idx, idx + 1200);
    assert.ok(
      block.includes("ownerEntities"),
      "sanitizeMemoBorrowerStory call must include ownerEntities",
    );
  });

  it("[render-time-5] buildCanonicalCreditMemo passes managementProfiles to sanitizer", () => {
    const idx = MEMO_BUILDER_SRC.indexOf("sanitizeMemoBorrowerStory(");
    const block = MEMO_BUILDER_SRC.slice(idx, idx + 1200);
    assert.ok(
      block.includes("mgmtProfiles"),
      "sanitizeMemoBorrowerStory call must include managementProfiles",
    );
  });
});
