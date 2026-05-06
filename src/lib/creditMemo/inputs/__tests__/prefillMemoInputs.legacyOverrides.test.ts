/**
 * SPEC-13 — pure prefill suggestions for legacy `deal_memo_overrides` keys.
 *
 * Tests the deterministic projection from a legacy override map into
 * borrower-story + management-profile suggestions. Source must be
 * "banker_override_legacy" with confidence 0.85 to flag the row for
 * banker review in the Memo Inputs UI.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBorrowerStorySuggestions,
  buildManagementSuggestions,
} from "../prefillMemoInputsPure";

test("[prefill-legacy-1] business_description projects from legacy when deal+research are absent", () => {
  const out = buildBorrowerStorySuggestions({
    deal: { description: null, industry: null, naics_code: null },
    research: null,
    legacyOverrides: { business_description: "Industrial mfg, 30y operating history" },
  });
  assert.ok(out.business_description);
  assert.equal(out.business_description!.source, "banker_override_legacy");
  assert.equal(out.business_description!.confidence, 0.85);
  assert.equal(out.business_description!.value, "Industrial mfg, 30y operating history");
});

test("[prefill-legacy-2] research wins over legacy when both present (precedence preserved)", () => {
  const out = buildBorrowerStorySuggestions({
    deal: { description: null, industry: null, naics_code: null },
    research: { industry_overview: "Researcher's narrative" },
    legacyOverrides: { business_description: "Banker's note" },
  });
  assert.ok(out.business_description);
  assert.equal(out.business_description!.source, "research");
  assert.equal(out.business_description!.value, "Researcher's narrative");
});

test("[prefill-legacy-3] principal_bio_<owner-id> projects into resume_summary suggestion", () => {
  const ownerId = "11111111-2222-3333-4444-555555555555";
  const profiles = buildManagementSuggestions({
    owners: [
      { id: ownerId, display_name: "Jane Founder", title: "CEO", ownership_pct: 60 },
    ],
    legacyOverrides: {
      [`principal_bio_${ownerId}`]: "20y industry, prior exit, MBA",
    },
  });
  assert.equal(profiles.length, 1);
  const p = profiles[0];
  assert.ok(p.resume_summary);
  assert.equal(p.resume_summary!.source, "banker_override_legacy");
  assert.equal(p.resume_summary!.confidence, 0.85);
  assert.equal(p.resume_summary!.value, "20y industry, prior exit, MBA");
  assert.equal(p.resume_summary!.source_id, ownerId);
});
