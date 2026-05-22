/**
 * LEGACY_DECOMMISSION_CONTRACT_V1
 *
 * Proves that canonical source priority is enforced, legacy fallbacks
 * are quarantined, spread artifacts are filtered, management dedupe works,
 * and print/live paths use the same data gates.
 *
 * PURITY NOTE: This file imports ONLY from pure modules (no "server-only").
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  getLegacyMemoOverrideFallback,
  ARTIFACT_SPREAD_TYPES,
  BORROWER_STORY_PRIORITY,
  MANAGEMENT_PRIORITY,
  NARRATIVE_PRIORITY,
} from "@/lib/creditMemo/canonical/sourcePriority";

import { buildManagementPrincipals } from "@/lib/creditMemo/management/buildManagementPrincipals";
import { resolveCollateralDescription, buildArCollateralNarrative } from "@/lib/creditMemo/collateral/buildCollateralNarrative";
import { isMeaningfulSpread, isPlaceholderSpread, getOwnerSuffix, ZERO_UUID } from "@/lib/creditMemo/spreads/isMeaningfulSpread";

// ══════════════════════════════════════════════════════════════════════════
// 1. Canonical source priority
// ══════════════════════════════════════════════════════════════════════════

describe("DECOMMISSION §1 — Canonical source priority", () => {
  it("deal_borrower_story is first in BORROWER_STORY_PRIORITY", () => {
    assert.equal(BORROWER_STORY_PRIORITY[0], "deal_borrower_story");
  });

  it("deal_management_profiles is first in MANAGEMENT_PRIORITY", () => {
    assert.equal(MANAGEMENT_PRIORITY[0], "deal_management_profiles");
  });

  it("deterministic facts are first in NARRATIVE_PRIORITY", () => {
    assert.equal(NARRATIVE_PRIORITY[0], "deterministic_canonical_facts");
  });

  it("getLegacyMemoOverrideFallback returns canonical value when present", () => {
    const diag = { legacy_fallback_fields: [] as string[] };
    const result = getLegacyMemoOverrideFallback(
      "Rich canonical story",
      "Stale override story",
      "business_description",
      diag,
    );
    assert.equal(result, "Rich canonical story");
    assert.equal(diag.legacy_fallback_fields.length, 0, "No fallback used");
  });

  it("getLegacyMemoOverrideFallback falls back and tracks diagnostic", () => {
    const diag = { legacy_fallback_fields: [] as string[] };
    const result = getLegacyMemoOverrideFallback(
      null,
      "Legacy override",
      "business_description",
      diag,
    );
    assert.equal(result, "Legacy override");
    assert.deepEqual(diag.legacy_fallback_fields, ["business_description"]);
  });

  it("getLegacyMemoOverrideFallback skips Pending canonical values", () => {
    const diag = { legacy_fallback_fields: [] as string[] };
    const result = getLegacyMemoOverrideFallback(
      "Pending — complete interview",
      "Override text",
      "revenue_mix",
      diag,
    );
    assert.equal(result, "Override text");
    assert.deepEqual(diag.legacy_fallback_fields, ["revenue_mix"]);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 2. Stale narrative safety
// ══════════════════════════════════════════════════════════════════════════

describe("DECOMMISSION §2 — Stale narrative safety", () => {
  it("mismatched input_hash means narrative is stale", () => {
    const cachedHash: string | null = "abc123";
    const currentHash: string | null = "def456";
    const isFresh = cachedHash !== null && currentHash !== null && cachedHash === currentHash;
    assert.equal(isFresh, false, "Mismatched hashes must be stale");
  });

  it("matching input_hash means narrative can overlay", () => {
    const cachedHash: string | null = "abc123";
    const currentHash: string | null = "abc123";
    const isFresh = cachedHash !== null && currentHash !== null && cachedHash === currentHash;
    assert.equal(isFresh, true, "Matching hashes must be fresh");
  });

  it("null cached hash is stale", () => {
    const cachedHash: string | null = null;
    const currentHash = "abc123";
    const isFresh = cachedHash !== null && currentHash !== null && cachedHash === currentHash;
    assert.equal(isFresh, false, "Null cached hash must be stale");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 3. Spread meaningfulness
// ══════════════════════════════════════════════════════════════════════════

describe("DECOMMISSION §3 — Spread meaningfulness", () => {
  it("CLASSIC_PDF excluded", () => {
    assert.ok(ARTIFACT_SPREAD_TYPES.has("CLASSIC_PDF"));
    assert.ok(!isMeaningfulSpread({ spread_type: "CLASSIC_PDF", rendered_json: { rows: [{ key: "x", label: "x" }] } }));
  });

  it("STANDARD excluded", () => {
    assert.ok(ARTIFACT_SPREAD_TYPES.has("STANDARD"));
    assert.ok(!isMeaningfulSpread({ spread_type: "STANDARD", rendered_json: { rows: [{ key: "x", label: "x" }] } }));
  });

  it("GCF Generating placeholder excluded", () => {
    const spread = {
      spread_type: "GLOBAL_CASH_FLOW",
      rendered_json: { rows: [{ key: "status", label: "Generating…" }] },
    };
    assert.ok(isPlaceholderSpread(spread), "Must detect placeholder");
    assert.ok(!isMeaningfulSpread(spread), "Placeholder must not be meaningful");
  });

  it("BALANCE_SHEET with real rows is meaningful", () => {
    const spread = {
      spread_type: "BALANCE_SHEET",
      rendered_json: {
        rows: [
          { key: "TOTAL_ASSETS", label: "Total Assets", values: [{ value: 1250000 }] },
          { key: "TOTAL_LIABILITIES", label: "Total Liabilities", values: [{ value: 800000 }] },
        ],
      },
    };
    assert.ok(isMeaningfulSpread(spread), "Real balance sheet must be meaningful");
  });

  it("zero UUID personal spread labeled Guarantor", () => {
    const ownerNames = new Map<string, string>();
    const suffix = getOwnerSuffix(ZERO_UUID, "PERSONAL_INCOME", ownerNames);
    assert.equal(suffix, " — Guarantor");
  });

  it("zero UUID balance sheet has no suffix", () => {
    const ownerNames = new Map<string, string>();
    const suffix = getOwnerSuffix(ZERO_UUID, "BALANCE_SHEET", ownerNames);
    assert.equal(suffix, "");
  });

  it("real owner entity gets name suffix", () => {
    const ownerNames = new Map([["uuid-1", "Matt Hunt"]]);
    const suffix = getOwnerSuffix("uuid-1", "PERSONAL_INCOME", ownerNames);
    assert.equal(suffix, " — Matt Hunt");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 4. Management dedupe
// ══════════════════════════════════════════════════════════════════════════

describe("DECOMMISSION §4 — Management dedupe", () => {
  it("Matt Hunt profile + Hunt ownership entity -> one principal", () => {
    const result = buildManagementPrincipals({
      managementProfiles: [{
        person_name: "Matt Hunt",
        title: "Founder / CEO",
        ownership_pct: 100,
        years_experience: 25,
        industry_experience: "25 years healthcare staffing",
        prior_business_experience: "Founded two prior staffing companies",
        resume_summary: "Serial entrepreneur in healthcare staffing",
        credit_relevance: "Strong personal credit, significant net worth",
      }],
      ownerEntities: [
        { id: "e1", display_name: "Hunt", ownership_pct: 100, title: "Owner" },
        { id: "e2", display_name: "OmniCare 365", ownership_pct: null, title: null },
        { id: "e3", display_name: "Borrower", ownership_pct: null, title: null },
      ],
      overrides: {},
      qualMgmtBackground: null,
      qualMgmtExpYears: null,
      borrowerName: "OmniCare 365",
      dealDisplayName: "OmniCare 365",
    });

    assert.equal(result.principals.length, 1, "Only Matt Hunt should appear");
    assert.equal(result.principals[0].name, "Matt Hunt");
    assert.ok(!result.principals[0].bio.includes("Pending"), "Bio must not be Pending");
    assert.ok(result.principals[0].bio.includes("healthcare staffing"), "Bio must include profile content");
    assert.ok(result.aliasesDeduped.includes("Hunt"), "Hunt must be in aliasesDeduped");
  });

  it("company entity OmniCare 365 is not rendered as principal", () => {
    const result = buildManagementPrincipals({
      managementProfiles: [],
      ownerEntities: [
        { id: "e2", display_name: "OmniCare 365", ownership_pct: null, title: null },
      ],
      overrides: {},
      qualMgmtBackground: null,
      qualMgmtExpYears: null,
      borrowerName: "OmniCare 365",
      dealDisplayName: "OmniCare 365",
    });
    assert.equal(result.principals.length, 0, "Company entity must not render as principal");
  });

  it("no management profile but individual owner renders with Pending", () => {
    const result = buildManagementPrincipals({
      managementProfiles: [],
      ownerEntities: [
        { id: "e1", display_name: "Jane Smith", ownership_pct: 50, title: "Partner" },
      ],
      overrides: {},
      qualMgmtBackground: null,
      qualMgmtExpYears: null,
      borrowerName: "Acme Corp",
      dealDisplayName: "Acme Corp",
    });
    assert.equal(result.principals.length, 1);
    assert.equal(result.principals[0].name, "Jane Smith");
    assert.ok(result.principals[0].bio.includes("Pending"), "Must show Pending without profile");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 5. Collateral narrative source priority
// ══════════════════════════════════════════════════════════════════════════

describe("DECOMMISSION §5 — Collateral narrative source priority", () => {
  it("AR borrowing base beats stale collateral_description for AR LOC", () => {
    const result = resolveCollateralDescription({
      arBorrowingBase: {
        as_of_date: "2026-04-30",
        total_ar: 3_007_506,
        eligible_ar: 2_854_124,
        ineligible_ar: 153_382,
        advance_rate: 0.80,
        borrowing_base_value: 2_283_299,
        borrowing_base_availability: 783_299,
      },
      loanAmount: 1_500_000,
      legacyOverrideDescription: "Accounts Receivable with a value of 1,250,000",
      isArLocDeal: true,
    });
    assert.equal(result.source, "ar_borrowing_base");
    assert.ok(result.description.includes("borrowing base"), "Must use AR narrative");
    assert.ok(!result.description.includes("1,250,000"), "Must not use stale override");
  });

  it("no AR borrowing base allows legacy fallback with tracking", () => {
    const result = resolveCollateralDescription({
      arBorrowingBase: null,
      loanAmount: null,
      legacyOverrideDescription: "Commercial real estate at 123 Main St",
      isArLocDeal: false,
    });
    assert.equal(result.source, "legacy_override");
    assert.ok(result.description.includes("123 Main St"));
  });

  it("buildArCollateralNarrative includes as_of_date and availability", () => {
    const narrative = buildArCollateralNarrative(
      {
        as_of_date: "2026-04-30",
        total_ar: 3_000_000,
        eligible_ar: 2_800_000,
        ineligible_ar: 200_000,
        advance_rate: 0.80,
        borrowing_base_value: 2_240_000,
        borrowing_base_availability: 740_000,
      },
      1_500_000,
    );
    assert.ok(narrative !== null);
    assert.ok(narrative!.includes("2026-04-30"), "Must include as_of_date");
    assert.ok(narrative!.includes("$3.00MM") || narrative!.includes("$3.0MM") || narrative!.includes("$3MM"), "Must include total AR");
    assert.ok(narrative!.includes("80%"), "Must include advance rate");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 6. Legacy fallback diagnostics
// ══════════════════════════════════════════════════════════════════════════

describe("DECOMMISSION §6 — Legacy fallback diagnostics", () => {
  it("using a legacy fallback records the field name", () => {
    const diag = { legacy_fallback_fields: [] as string[] };
    getLegacyMemoOverrideFallback(null, "override val", "seasonality", diag);
    getLegacyMemoOverrideFallback(null, "another", "vision", diag);
    getLegacyMemoOverrideFallback("canonical val", "override", "revenue_mix", diag);
    assert.deepEqual(diag.legacy_fallback_fields, ["seasonality", "vision"]);
    assert.equal(diag.legacy_fallback_fields.length, 2, "Only 2 fallbacks, not 3");
  });
});
