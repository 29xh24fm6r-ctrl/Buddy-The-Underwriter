import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
import type { BIEResult } from "@/lib/research/buddyIntelligenceEngine";

/**
 * Regression for specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md: narrative
 * sentences must be attributed to only the sources whose grounded text
 * segment actually overlaps that sentence, not every source cited anywhere
 * in the thread.
 */

mockServerOnly();
const require_ = createRequire(import.meta.url);
const { buildBIENarrativeSections } =
  require_("@/lib/research/buddyIntelligenceEngine") as typeof import("@/lib/research/buddyIntelligenceEngine");

function bie(): BIEResult {
  const emptyThreadMap = { entity_lock: [], borrower: [], management: [], competitive: [], market: [], industry: [], transaction: [] };
  return {
    entity_lock: null,
    entity_confirmed: false,
    entity_confidence: 0,
    entity_classification: "probable_private_entity",
    borrower: null,
    management: null,
    management_basis: null,
    competitive: null,
    market: null,
    industry: {
      industry_size_and_growth: "The BPO industry generates roughly $250 billion annually with steady mid-single-digit growth.",
      key_trends: "Automation and AI-assisted workflows are reshaping headcount needs across the sector.",
      disruption_risks: "",
      margin_environment: "",
      regulatory_landscape: "",
      five_year_outlook: "",
      credit_risk_profile: "",
      trend_direction: "stable",
    } as any,
    transaction: null,
    synthesis: null,
    research_quality: "deep",
    sources_used: [],
    thread_sources: {
      ...emptyThreadMap,
      industry: ["https://ibisworld.com/bpo-report", "https://statista.com/bpo-trends"],
    },
    thread_segments: {
      ...emptyThreadMap,
      industry: [
        {
          text: "The BPO industry generates roughly $250 billion annually with steady mid-single-digit growth.",
          urls: ["https://ibisworld.com/bpo-report"],
          confidences: [1],
        },
        {
          text: "Automation and AI-assisted workflows are reshaping headcount needs across the sector.",
          urls: ["https://statista.com/bpo-trends"],
          confidences: [1],
        },
      ],
    },
    thread_diagnostics: {} as any,
    compiled_at: "2026-07-12T00:00:00Z",
  };
}

test("sentences attribute to only the source that grounds them, not the pooled thread list", () => {
  const sections = buildBIENarrativeSections(bie());
  const overview = sections.find((s) => s.title === "Industry Overview");
  assert.ok(overview, "Industry Overview section should exist");
  assert.equal(overview!.sentences.length, 2);

  const sizeSentence = overview!.sentences.find((s) => s.text.includes("$250 billion"));
  const trendSentence = overview!.sentences.find((s) => s.text.includes("Automation"));
  assert.ok(sizeSentence);
  assert.ok(trendSentence);

  const sizeUrls = sizeSentence!.citations.map((c: any) => c.url);
  const trendUrls = trendSentence!.citations.map((c: any) => c.url);

  assert.deepEqual(sizeUrls, ["https://ibisworld.com/bpo-report"]);
  assert.deepEqual(trendUrls, ["https://statista.com/bpo-trends"]);
});

test("no matching segment falls back to the thread-wide source list", () => {
  const fixture = bie();
  fixture.industry!.disruption_risks = "A totally unrelated sentence with no grounded segment at all.";
  const sections = buildBIENarrativeSections(fixture);
  const outlook = sections.find((s) => s.title === "Industry Outlook");
  assert.ok(outlook);
  const disruptionSentence = outlook!.sentences.find((s) => s.text.includes("unrelated"));
  assert.ok(disruptionSentence);
  const urls = disruptionSentence!.citations.map((c: any) => c.url).sort();
  assert.deepEqual(urls, ["https://ibisworld.com/bpo-report", "https://statista.com/bpo-trends"]);
});
