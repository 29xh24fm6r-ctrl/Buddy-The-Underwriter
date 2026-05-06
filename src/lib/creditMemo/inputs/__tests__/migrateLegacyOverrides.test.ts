/**
 * SPEC-13 — pure transform tests for migrateLegacyOverridesToCanonical.
 *
 * Tests the deterministic mapping from legacy `deal_memo_overrides.overrides`
 * JSON into BorrowerStory + ManagementProfile writes. The async wrapper
 * (migrateLegacyOverridesAsync) is server-only and is not exercised here —
 * these tests prove the contract that wrapper relies on.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { transformLegacyOverrides } from "../migrateLegacyOverridesToCanonical";

const DEAL = "deal-1";
const BANK = "bank-1";

test("[migrate-1] empty overrides → 0 borrower-story writes, 0 mgmt writes", () => {
  const r = transformLegacyOverrides({
    dealId: DEAL,
    bankId: BANK,
    overrides: {},
    ownershipEntities: [],
    borrowerStoryAlreadyExists: false,
  });
  assert.equal(r.borrowerStory.kind, "skipped");
  if (r.borrowerStory.kind === "skipped") {
    assert.equal(r.borrowerStory.reason, "no_useful_keys");
  }
  assert.equal(r.managementProfiles.length, 0);
});

test("[migrate-2] business_description + revenue_mix → 1 borrower-story row with both fields", () => {
  const r = transformLegacyOverrides({
    dealId: DEAL,
    bankId: BANK,
    overrides: {
      business_description: "Industrial mfg",
      revenue_mix: "70% recurring",
    },
    ownershipEntities: [],
    borrowerStoryAlreadyExists: false,
  });
  assert.equal(r.borrowerStory.kind, "write");
  if (r.borrowerStory.kind === "write") {
    assert.equal(r.borrowerStory.write.patch.business_description, "Industrial mfg");
    assert.equal(r.borrowerStory.write.patch.revenue_model, "70% recurring");
    assert.equal(r.borrowerStory.write.source, "banker");
    assert.equal(r.borrowerStory.write.confidence, 0.85);
  }
  assert.equal(r.managementProfiles.length, 0);
});

test("[migrate-3] two principal_bio_<uuid> with matching ownership_entities → 2 mgmt rows with display_name", () => {
  const r = transformLegacyOverrides({
    dealId: DEAL,
    bankId: BANK,
    overrides: {
      "principal_bio_owner-a": "Founder, 20y industry",
      "principal_bio_owner-b": "CFO, ex-Big4",
    } as Record<string, unknown>,
    ownershipEntities: [
      { id: "owner-a", display_name: "Alice Smith" },
      { id: "owner-b", display_name: "Bob Jones" },
    ],
    borrowerStoryAlreadyExists: false,
  });
  assert.equal(r.managementProfiles.length, 2);
  const a = r.managementProfiles.find((p) => p.ownershipEntityId === "owner-a");
  const b = r.managementProfiles.find((p) => p.ownershipEntityId === "owner-b");
  assert.ok(a && b);
  assert.equal(a!.patch.person_name, "Alice Smith");
  assert.equal(a!.patch.resume_summary, "Founder, 20y industry");
  assert.equal(b!.patch.person_name, "Bob Jones");
  assert.equal(b!.patch.resume_summary, "CFO, ex-Big4");
  for (const p of r.managementProfiles) {
    assert.equal(p.source, "banker");
    assert.equal(p.confidence, 0.85);
  }
});

test("[migrate-4] principal_bio_<uuid> without matching entity → mgmt row with person_name='Unknown' (don't drop)", () => {
  const r = transformLegacyOverrides({
    dealId: DEAL,
    bankId: BANK,
    overrides: {
      "principal_bio_unknown-id": "Anonymous founder note",
    },
    ownershipEntities: [],
    borrowerStoryAlreadyExists: false,
  });
  assert.equal(r.managementProfiles.length, 1);
  assert.equal(r.managementProfiles[0].patch.person_name, "Unknown");
  assert.equal(
    r.managementProfiles[0].patch.resume_summary,
    "Anonymous founder note",
  );
});

test("[migrate-5] borrowerStoryAlreadyExists → returns skipped, no writes", () => {
  const r = transformLegacyOverrides({
    dealId: DEAL,
    bankId: BANK,
    overrides: {
      business_description: "Should not be written",
      principal_bio_x: "Should not be written either",
    },
    ownershipEntities: [{ id: "x", display_name: "Existing" }],
    borrowerStoryAlreadyExists: true,
  });
  assert.equal(r.borrowerStory.kind, "skipped");
  if (r.borrowerStory.kind === "skipped") {
    assert.equal(r.borrowerStory.reason, "borrower_story_exists");
  }
  assert.equal(r.managementProfiles.length, 0);
});
