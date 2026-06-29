/**
 * SPEC-FINENGINE-KNOWLEDGE-WIRE-1 — Workstream B: industry-calibrated reasonableness.
 *
 * buildCertifiedSnapshots now threads the deal's IndustryProfile into
 * checkReasonableness, so the profile-gated warnings (PROSERV_DSO_HIGH, …) fire.
 * The runner resolves the profile from NAICS via getIndustryProfile.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { buildCertifiedSnapshots, type CertifiedFactRow } from "@/lib/finengine/shadow/dealInputAdapter";
import { getIndustryProfile } from "@/lib/industryIntelligence/naicsMapper";
import { PROFESSIONAL_SERVICES_PROFILE, DEFAULT_PROFILE } from "@/lib/industryIntelligence";

const DEAL = "00000000-0000-0000-0000-000000000000";

function row(
  fact_key: string, fact_period_end: string, fact_value_num: number,
  source_canonical_type: string, owner_type: string, confidence: number, extractor: string,
): CertifiedFactRow {
  return { fact_key, fact_period_end, fact_value_num, source_canonical_type, owner_type, confidence, extractor, is_superseded: false, created_at: "2026-06-01T00:00:00Z" };
}

// A BUSINESS period with DSO ≈ 120 days (AR 1.2M on 3.65M revenue ⇒ 10k/day).
const DSO_HIGH_ROWS: CertifiedFactRow[] = [
  row("GROSS_RECEIPTS", "2024-12-31", 3_650_000, "BUSINESS_TAX_RETURN", "DEAL", 0.8, "gemini_primary_v1"),
  row("ACCOUNTS_RECEIVABLE", "2024-12-31", 1_200_000, "BUSINESS_TAX_RETURN", "DEAL", 0.8, "gemini_primary_v1"),
];

describe("Knowledge-wire B — industry threading into reasonableness", () => {
  it("T-B1: professionalServices DSO>90 fires PROSERV_DSO_HIGH; default does not", () => {
    const withProfile = buildCertifiedSnapshots(DEAL, DSO_HIGH_ROWS, { industry: PROFESSIONAL_SERVICES_PROFILE });
    const biz = withProfile.find((s) => s.entityScope === "BUSINESS" && s.fiscalPeriodEnd === "2024-12-31");
    assert.ok(biz, "business 2024 snapshot exists");
    assert.ok(
      biz!.warnings.some((w) => w.includes("PROSERV_DSO_HIGH")),
      "professionalServices profile fires the DSO warning",
    );

    const withDefault = buildCertifiedSnapshots(DEAL, DSO_HIGH_ROWS, { industry: DEFAULT_PROFILE });
    const bizDefault = withDefault.find((s) => s.entityScope === "BUSINESS" && s.fiscalPeriodEnd === "2024-12-31");
    assert.ok(
      !bizDefault!.warnings.some((w) => w.includes("PROSERV_DSO_HIGH")),
      "default profile does NOT fire the proserv-specific warning",
    );

    // And with NO industry passed at all (the pre-wire behavior) it also must not fire.
    const noProfile = buildCertifiedSnapshots(DEAL, DSO_HIGH_ROWS);
    const bizNone = noProfile.find((s) => s.entityScope === "BUSINESS" && s.fiscalPeriodEnd === "2024-12-31");
    assert.ok(!bizNone!.warnings.some((w) => w.includes("PROSERV_DSO_HIGH")));
  });
});

describe("Knowledge-wire B — NAICS → industry profile mapping", () => {
  it("T-B2: maps representative NAICS codes to the right profile, unknown → default", () => {
    assert.equal(getIndustryProfile("541110").naicsCode, "541"); // legal → professionalServices
    assert.equal(getIndustryProfile("541110").displayName, PROFESSIONAL_SERVICES_PROFILE.displayName);
    assert.equal(getIndustryProfile("722511").naicsCode, "722"); // full-service restaurant
    assert.equal(getIndustryProfile("445110").naicsCode, "44"); // grocery → retail (44/45)
    assert.equal(getIndustryProfile("452210").naicsCode, "44"); // general merchandise → retail
    assert.equal(getIndustryProfile("999999").displayName, DEFAULT_PROFILE.displayName); // unmapped → default
    assert.equal(getIndustryProfile(null).displayName, DEFAULT_PROFILE.displayName); // absent → default
  });
});

describe("Knowledge-wire B — source guard", () => {
  it("no inert empty-industry checkReasonableness(facts, \"\") call remains in the adapter", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const adapter = readFileSync(join(here, "..", "shadow", "dealInputAdapter.ts"), "utf8");
    assert.ok(
      !adapter.includes('checkReasonableness(facts, "")'),
      "the empty 2-arg reasonableness call must be replaced by the industry-threaded call",
    );
    assert.ok(
      adapter.includes("checkReasonableness(facts, \"\", undefined, opts?.industry)"),
      "the adapter threads the industry profile into checkReasonableness",
    );
  });
});
