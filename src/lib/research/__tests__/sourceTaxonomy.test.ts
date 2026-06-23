import test from "node:test";
import assert from "node:assert/strict";

import {
  classifySourceUrl,
  computeSourceQualityScore,
  normalizeDomain,
} from "@/lib/research/sourcePolicy";

/**
 * SPEC-BIE-SAFE-PRIVATE-COMPANY-RESEARCH-HARDENING-1 — Phase 2
 * Public source taxonomy reclassification.
 */

test("[domain] normalizeDomain strips protocol/www/path/port", () => {
  assert.equal(normalizeDomain("https://www.OmniCare365.com/about?x=1"), "omnicare365.com");
  assert.equal(normalizeDomain("omnicare365.com"), "omnicare365.com");
  assert.equal(normalizeDomain("http://omnicare365.com:8080/x"), "omnicare365.com");
  assert.equal(normalizeDomain(""), null);
  assert.equal(normalizeDomain(null), null);
});

test("[classify] borrower's own website → borrower_official_website (www-insensitive)", () => {
  const opts = { borrowerDomain: "omnicare365.com" };
  assert.equal(classifySourceUrl("https://www.omnicare365.com/services", opts), "borrower_official_website");
  assert.equal(classifySourceUrl("http://omnicare365.com", opts), "borrower_official_website");
  assert.equal(classifySourceUrl("https://careers.omnicare365.com/jobs", opts), "borrower_official_website");
});

test("[classify] non-matching website is NOT borrower_official_website/company_primary", () => {
  const opts = { borrowerDomain: "omnicare365.com" };
  const t = classifySourceUrl("https://someothercompany.com/about", opts);
  assert.notEqual(t, "borrower_official_website");
  assert.notEqual(t, "company_primary");
});

test("[classify] secretary of state URL → secretary_of_state", () => {
  assert.equal(classifySourceUrl("https://sunbiz.org/Inquiry/CorporationSearch"), "secretary_of_state");
  assert.equal(classifySourceUrl("https://bizfileonline.sos.ca.gov/search/business"), "secretary_of_state");
});

test("[classify] business registry → business_registry", () => {
  assert.equal(classifySourceUrl("https://opencorporates.com/companies/us_tx/123"), "business_registry");
  assert.equal(classifySourceUrl("https://www.dnb.com/business-directory/company-profiles.x.html"), "business_registry");
});

test("[classify] .gov economic data → government_data", () => {
  assert.equal(classifySourceUrl("https://www.bls.gov/oes/current/oes_tx.htm"), "government_data");
  assert.equal(classifySourceUrl("https://data.gov/dataset/x"), "government_data");
});

test("[classify] local business journal → news_primary", () => {
  assert.equal(classifySourceUrl("https://www.bizjournals.com/dallas/news/x"), "news_primary");
});

test("[classify] adverse-record search → public_adverse_record_search", () => {
  assert.equal(classifySourceUrl("https://sam.gov/search/exclusions"), "public_adverse_record_search");
});

test("[classify] unknown URL → unknown_public_web (never bare 'unknown')", () => {
  assert.equal(classifySourceUrl("https://randomblog.example/post/1"), "unknown_public_web");
  assert.equal(classifySourceUrl(""), "unknown_public_web");
});

test("[score] quality improves only when valid source types exist", () => {
  const weakOnly = computeSourceQualityScore([
    "https://randomblog.example/a",
    "https://anotherblog.example/b",
  ]);
  const withInstitutional = computeSourceQualityScore([
    "https://randomblog.example/a",
    "https://sunbiz.org/x",
    "https://www.bls.gov/x",
  ]);
  assert.ok(withInstitutional > weakOnly, "institutional sources should lift the score");
  // Borrower website lifts borrower-profile quality vs unknown
  const borrowerSite = computeSourceQualityScore(
    ["https://omnicare365.com/about"],
    { borrowerDomain: "omnicare365.com" },
  );
  const unknownSite = computeSourceQualityScore(["https://omnicare365.com/about"]);
  assert.ok(borrowerSite > unknownSite);
});
