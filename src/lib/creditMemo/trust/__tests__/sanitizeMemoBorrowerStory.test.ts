// Guard tests for sanitizeMemoBorrowerStory — the pure render-time helper.
// Proves memo-facing narrative no longer includes known person-role confusion.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sanitizeMemoBorrowerStory } from "../sanitizeMemoBorrowerStory";

describe("sanitizeMemoBorrowerStory", () => {
  const ownerEntities = [
    { display_name: "Matt Hunt", name: "Matt Hunt", ownership_pct: 100 },
  ];
  const managementProfiles = [
    { person_name: "Matt Hunt", ownership_pct: 100 },
  ];

  it("rewrites first-name-only 'Matt' to 'Hunt' in business_description", () => {
    const result = sanitizeMemoBorrowerStory({
      fields: {
        business_description: "Matt personally manages major client relationships.",
      },
      ownerEntities,
      managementProfiles,
    });
    assert.ok(result.fields.business_description);
    assert.ok(!result.fields.business_description.includes("Matt personally"));
    assert.ok(result.fields.business_description.includes("Hunt personally"));
  });

  it("flags ambiguous first name when both Matt Hunt and Matt Paller are known", () => {
    const result = sanitizeMemoBorrowerStory({
      fields: {
        key_risks: "Matt agreed the Aetna ramp creates timing risk.",
      },
      ownerEntities,
      managementProfiles: [
        { person_name: "Matt Hunt", ownership_pct: 100 },
        { person_name: "Matt Paller", ownership_pct: 0 },
      ],
    });
    assert.ok(result.warnings.some((w) => w.code === "ambiguous_first_name_rewritten"));
  });

  it("rewrites 'Mike Ringer' to 'Mike Ring' in narrative fields", () => {
    const result = sanitizeMemoBorrowerStory({
      fields: {
        business_description: "Referred through Mike Ringer.",
        competitive_advantages: "Ringer discussed the bank relationship.",
      },
      ownerEntities: [],
      managementProfiles: [],
    });
    assert.ok(result.fields.business_description);
    assert.ok(!result.fields.business_description.includes("Mike Ringer"));
    assert.ok(result.fields.business_description.includes("Mike Ring"));
    assert.ok(result.fields.competitive_advantages);
    assert.ok(!result.fields.competitive_advantages.includes("Ringer"));
    assert.ok(result.fields.competitive_advantages.includes("Ring"));
  });

  it("cleans double punctuation artifacts across all fields", () => {
    const result = sanitizeMemoBorrowerStory({
      fields: {
        vision: "All growth is referral-driven team.. Growth strategy is organic.",
      },
      ownerEntities: [],
      managementProfiles: [],
    });
    assert.ok(result.fields.vision);
    assert.ok(!result.fields.vision.includes(".."));
    assert.ok(result.fields.vision.includes("team. Growth"));
  });

  it("passes through null and undefined fields unchanged", () => {
    const result = sanitizeMemoBorrowerStory({
      fields: {
        business_description: null,
        revenue_mix: undefined,
        seasonality: "Normal seasonal patterns.",
      },
      ownerEntities: [],
      managementProfiles: [],
    });
    assert.equal(result.fields.business_description, null);
    assert.equal(result.fields.revenue_mix, undefined);
    assert.equal(result.fields.seasonality, "Normal seasonal patterns.");
    assert.equal(result.warnings.length, 0);
  });

  it("sanitizes all 9 narrative fields when populated", () => {
    const fields = {
      business_description: "Matt runs operations.",
      revenue_mix: "Matt drives sales.",
      seasonality: "Matt adjusts staffing.",
      competitive_advantages: "Matt built key relationships.",
      vision: "Matt plans expansion.",
      products_services: "Matt manages product lines.",
      customers: "Matt serves enterprise clients.",
      customer_concentration: "Matt holds Aetna contract.",
      key_risks: "Matt is key person risk.",
    };
    const result = sanitizeMemoBorrowerStory({
      fields,
      ownerEntities,
      managementProfiles,
    });
    for (const [key, value] of Object.entries(result.fields)) {
      assert.ok(typeof value === "string", `${key} should be a string`);
      assert.ok(!value.includes("Matt "), `${key} should not contain first-name-only 'Matt'`);
      assert.ok(value.includes("Hunt"), `${key} should contain last name 'Hunt'`);
    }
  });
});
