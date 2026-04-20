// src/lib/sba/sbaResearchExtractor.ts
// Phase 2 — Structured research extraction for business-plan narrative prompts.
// Replaces the previous 2KB JSON.stringify dump with a clean per-section
// prose block that the Gemini prompts can inject verbatim.

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

export interface ExtractedResearch {
  industryOverview: string | null;
  industryOutlook: string | null;
  competitiveLandscape: string | null;
  marketIntelligence: string | null;
  borrowerProfile: string | null;
  managementIntelligence: string | null;
  regulatoryEnvironment: string | null;
  creditThesis: string | null;
  threeToFiveYearOutlook: string | null;
}

const EMPTY: ExtractedResearch = {
  industryOverview: null,
  industryOutlook: null,
  competitiveLandscape: null,
  marketIntelligence: null,
  borrowerProfile: null,
  managementIntelligence: null,
  regulatoryEnvironment: null,
  creditThesis: null,
  threeToFiveYearOutlook: null,
};

interface RawSection {
  title: string;
  sentences?: Array<{ text?: string } | null> | null;
}

function extractSection(
  sections: RawSection[],
  title: string,
  maxChars = 3000,
): string | null {
  const sec = sections.find(
    (s) => typeof s?.title === "string" && s.title.toLowerCase() === title.toLowerCase(),
  );
  if (!sec?.sentences || sec.sentences.length === 0) return null;

  const text = sec.sentences
    .map((s) => (s && typeof s.text === "string" ? s.text : ""))
    .filter((t) => t && t.length > 10)
    .join(" ");

  if (!text) return null;
  if (text.length <= maxChars) return text;

  const truncated = text.slice(0, maxChars);
  const lastPeriod = truncated.lastIndexOf(".");
  return lastPeriod > maxChars * 0.5
    ? truncated.slice(0, lastPeriod + 1)
    : truncated;
}

/**
 * Load the latest complete research mission for this deal and extract the
 * nine canonical sections used by the business plan narrative prompts.
 *
 * buddy_research_narratives does NOT store deal_id directly — it stores
 * mission_id. We join buddy_research_missions (which carries deal_id) and
 * prefer the most recently compiled narrative for the deal.
 */
export async function extractResearchForBusinessPlan(
  dealId: string,
): Promise<ExtractedResearch> {
  const sb = supabaseAdmin();

  // Find candidate missions (newest first). Prefer status='complete' but fall
  // back to any mission so we never silently drop research the borrower saw.
  const { data: missions } = await sb
    .from("buddy_research_missions")
    .select("id, status, completed_at, created_at")
    .eq("deal_id", dealId)
    .order("completed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(10);

  const missionIds = (missions ?? []).map(
    (m: { id: string }) => m.id,
  );
  if (missionIds.length === 0) return EMPTY;

  const { data: narrative } = await sb
    .from("buddy_research_narratives")
    .select("sections, compiled_at, mission_id")
    .in("mission_id", missionIds)
    .order("compiled_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!narrative?.sections || !Array.isArray(narrative.sections)) return EMPTY;

  const sections = narrative.sections as RawSection[];

  return {
    industryOverview: extractSection(sections, "Industry Overview"),
    industryOutlook: extractSection(sections, "Industry Outlook"),
    competitiveLandscape: extractSection(sections, "Competitive Landscape"),
    marketIntelligence: extractSection(sections, "Market Intelligence"),
    borrowerProfile: extractSection(sections, "Borrower Profile"),
    managementIntelligence: extractSection(sections, "Management Intelligence"),
    regulatoryEnvironment: extractSection(sections, "Regulatory Environment"),
    creditThesis: extractSection(sections, "Credit Thesis"),
    threeToFiveYearOutlook: extractSection(
      sections,
      "3-Year and 5-Year Outlook",
    ),
  };
}
