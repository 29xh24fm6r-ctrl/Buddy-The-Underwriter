import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
import type { BIEResult } from "@/lib/research/buddyIntelligenceEngine";

/**
 * Regression for specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md: claims must be
 * attributed to only the source URLs whose grounded text segment overlaps
 * that specific claim, not every source cited anywhere in the thread.
 */

mockServerOnly();
const require_ = createRequire(import.meta.url);
const { buildClaimRecords } =
  require_("@/lib/research/claimLedger") as typeof import("@/lib/research/claimLedger");

function bie(): BIEResult {
  const emptyThreadMap = { entity_lock: [], borrower: [], management: [], competitive: [], market: [], industry: [], transaction: [] };
  const positiveNews = "The company was named a regional employer of the year and expanded into a new state this quarter.";
  const litigation = "A former employee filed a wage-and-hour class action lawsuit against the company in 2024.";
  return {
    entity_lock: null,
    entity_confirmed: true,
    entity_confidence: 0.9,
    entity_classification: "probable_private_entity",
    borrower: {
      entity_confirmation: "Confirmed via state filing and company website.".padEnd(30, " "),
      entity_confidence: 0.9,
      company_overview: "Founded 2010, provides BPO services to regional healthcare clients.",
      reputation_and_reviews: "Positive reviews across major review platforms.",
      recent_news: positiveNews,
      litigation_and_risk: litigation,
      digital_presence: "Active website and social presence.",
      customer_base_and_reach: "Serves regional healthcare clients across three states.",
      trend_direction: "stable",
    },
    management: null,
    management_basis: null,
    competitive: null,
    market: null,
    industry: null,
    transaction: null,
    synthesis: null,
    research_quality: "deep",
    sources_used: [],
    thread_sources: {
      ...emptyThreadMap,
      borrower: ["https://businesswire.com/award", "https://courtlistener.com/case/123"],
    },
    thread_segments: {
      ...emptyThreadMap,
      borrower: [
        { text: positiveNews, urls: ["https://businesswire.com/award"], confidences: [1] },
        { text: litigation, urls: ["https://courtlistener.com/case/123"], confidences: [1] },
      ],
    },
    thread_diagnostics: {} as any,
    compiled_at: "2026-07-12T00:00:00Z",
  };
}

test("Litigation and Risk claim attributes only to the litigation-grounding source", () => {
  const claims = buildClaimRecords("m-test", bie());
  const litigationClaim = claims.find((c) => c.section === "Litigation and Risk");
  assert.ok(litigationClaim, "should produce a Litigation and Risk claim");
  assert.deepEqual(litigationClaim!.source_uris, ["https://courtlistener.com/case/123"]);
});

test("recent-news claim attributes only to the news-grounding source, not the litigation source", () => {
  const claims = buildClaimRecords("m-test", bie());
  const newsClaim = claims.find(
    (c) => c.section === "Borrower Profile" && c.claim_text.includes("employer of the year"),
  );
  assert.ok(newsClaim, "should produce a Borrower Profile claim for recent news");
  assert.deepEqual(newsClaim!.source_uris, ["https://businesswire.com/award"]);
  assert.ok(!newsClaim!.source_uris.includes("https://courtlistener.com/case/123"));
});
