import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  compileCreditCommitteePack,
  type CreditCommitteePack,
  type CreditCommitteePackSection,
  type RiskIndicator,
} from "@/lib/research/creditCommitteePack";

export type MemoResearchData = {
  // Core fields (populated from BRE or BIE)
  industry_overview: string;
  market_dynamics: string;
  competitive_positioning: string;
  regulatory_environment: string;
  risk_indicators: Array<{
    category: string;
    level: "low" | "medium" | "high";
    summary: string;
  }>;
  research_coverage: {
    missions_count: number;
    facts_count: number;
    inferences_count: number;
    sources_count: number;
    compiled_at: string | null;
  };
  // BIE v3 fields — populated when version 3 narrative exists
  credit_thesis?: string;
  structure_implications?: string[];
  underwriting_questions?: string[];
  monitoring_triggers?: string[];
  contradictions?: string[];
  management_intelligence?: string;
  litigation_and_risk?: string;
  transaction_analysis?: string;
  three_five_year_outlook?: string;
  research_quality_score?: "Strong" | "Moderate" | "Limited";
  sources_count_bie?: number;
  // Phase 78: Trust layer fields
  trust_grade?: "committee_grade" | "preliminary" | "manual_review_required" | "research_failed";
  quality_score?: number;
  entity_confirmed_name?: string | null;
  entity_confidence?: number;
  claims_count?: number;
};

const SECTION_MAP: Record<
  string,
  keyof Pick<
    MemoResearchData,
    "industry_overview" | "market_dynamics" | "competitive_positioning" | "regulatory_environment"
  >
> = {
  // BIE v3 titles
  "Industry Overview": "industry_overview",
  "Industry Outlook": "industry_overview",
  "Market Intelligence": "market_dynamics",
  "Borrower Profile": "industry_overview",
  "Credit Thesis": "industry_overview",
  "3-Year and 5-Year Outlook": "industry_overview",
  "Competitive Landscape": "competitive_positioning",
  "Regulatory Environment": "regulatory_environment",
  // Legacy BRE titles
  "Industry Landscape": "industry_overview",
  "Market Demand": "market_dynamics",
  "Market Dynamics": "market_dynamics",
  "Demographics": "market_dynamics",
  "Competitive Analysis": "competitive_positioning",
  "Summary": "industry_overview",
  "Institutional Insights": "market_dynamics",
};

function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[•\-\*]\s+/gm, "")
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .trim();
}

function sectionsToText(pack: CreditCommitteePack, ...titles: string[]): string {
  const parts: string[] = [];
  for (const section of pack.sections) {
    if (titles.includes(section.title)) {
      const text = section.content
        .map((s) => stripMarkdown(s.text))
        .filter((t) => t.length > 0)
        .join(" ");
      if (text.trim()) parts.push(text.trim());
    }
  }
  return parts.join("\n\n") || "Pending";
}

export async function loadResearchForMemo(args: {
  dealId: string;
  bankId?: string;
}): Promise<MemoResearchData | null> {
  const sb = supabaseAdmin();

  // Load completed missions for this deal
  const { data: missions, error: missionsErr } = await (sb as any)
    .from("buddy_research_missions")
    .select("*")
    .eq("deal_id", args.dealId)
    .eq("status", "complete")
    .order("completed_at", { ascending: false })
    .limit(1);

  if (missionsErr || !missions?.length) return null;

  const missionIds = [missions[0].id];

  // Load facts, inferences, sources, BIE narrative, and ownership entities in parallel
  const [factsRes, inferencesRes, sourcesRes, narrativeRes, ownersRes, qualityGateRes] = await Promise.all([
    (sb as any).from("buddy_research_facts").select("*").in("mission_id", missionIds),
    (sb as any).from("buddy_research_inferences").select("*").in("mission_id", missionIds),
    (sb as any).from("buddy_research_sources").select("*").in("mission_id", missionIds),
    // Pull BIE (version 3) narrative for any of these missions
    (sb as any)
      .from("buddy_research_narratives")
      .select("mission_id, sections, version")
      .in("mission_id", missionIds)
      .eq("version", 3)
      .limit(1)
      .maybeSingle(),
    // Layer 3 guard: load actual owners for management intelligence validation
    // CRITICAL: ownership_entities uses display_name (not name or entity_name)
    (sb as any)
      .from("ownership_entities")
      .select("display_name")
      .eq("deal_id", args.dealId)
      .limit(10),
    // Phase 78: quality gate for trust grade
    (sb as any)
      .from("buddy_research_quality_gates")
      .select("trust_grade, quality_score, entity_confidence")
      .eq("mission_id", missions[0].id)
      .maybeSingle(),
  ]);

  const allFacts = (factsRes.data ?? []) as any[];
  const allInferences = (inferencesRes.data ?? []) as any[];
  const allSources = (sourcesRes.data ?? []) as any[];
  const bieNarrative = narrativeRes.data as {
    sections: Array<{ title: string; sentences: Array<{ text: string; citations: unknown[] }> }>;
    version: number;
  } | null;

  // Build the set of known owner last names for management intelligence validation
  const knownOwnerLastNames = new Set(
    ((ownersRes.data ?? []) as any[])
      .map((o: any) => String(o.display_name ?? "").trim().split(/\s+/).pop()?.toLowerCase())
      .filter((s): s is string => typeof s === "string" && s.length > 1)
  );

  if (allFacts.length === 0) return null;

  // Direct BIE section extractor — bypasses BRE pack, skips metadata lines
  function extractBIESection(...titles: string[]): string {
    if (!bieNarrative?.sections) return "";
    const parts: string[] = [];
    for (const title of titles) {
      const sec = bieNarrative.sections.find((s: any) => s.title === title);
      if (sec) {
        const text = (sec.sentences ?? [])
          .map((s: any) => s.text ?? "")
          .filter((t: string) => t.length > 0 && !t.startsWith("BIE_META:"))
          .join(" ")
          .trim();
        if (text) parts.push(text);
      }
    }
    return parts.join("\n\n") || "";
  }
  const hasBIE = !!(bieNarrative?.sections?.length);

  // Group by mission
  const missionData = missions.map((m: any) => ({
    mission: m,
    facts: allFacts.filter((f: any) => f.mission_id === m.id),
    inferences: allInferences.filter((i: any) => i.mission_id === m.id),
    sources: allSources.filter((s: any) => s.mission_id === m.id),
  }));

  // Compile the credit committee pack (BRE pipeline)
  const result = compileCreditCommitteePack({
    deal_id: args.dealId,
    bank_id: args.bankId ?? null,
    missions: missionData,
  });

  if (!result.ok || !result.pack) return null;

  const pack = result.pack;

  // Merge BIE narrative sections into pack (NarrativeSection.sentences → CreditCommitteePackSection.content)
  if (bieNarrative?.sections) {
    for (const section of bieNarrative.sections) {
      pack.sections.push({
        section_type: "research",
        title: section.title,
        content: (section.sentences ?? []).map((s) => ({
          text: s.text ?? "",
          citations: (s.citations ?? []) as any[],
        })),
      } as CreditCommitteePackSection);
    }
  }

  // Unified section finder — works for both BRE and BIE sections
  const findSection = (title: string): string => sectionsToText(pack, title);

  // Extract BIE metadata (quality score + source count) from the BIE Sources section
  let bieQualityScore: "Strong" | "Moderate" | "Limited" | undefined;
  let bieSourcesCount: number | undefined;

  if (bieNarrative?.sections) {
    const bieMeta = bieNarrative.sections.find((s) => s.title === "BIE Sources");
    const metaLine = bieMeta?.sentences?.[0]?.text ?? "";
    if (metaLine.startsWith("BIE_META:")) {
      try {
        const meta = JSON.parse(metaLine.slice("BIE_META:".length));
        const qs = meta.research_quality_score;
        if (qs === "Strong" || qs === "Moderate" || qs === "Limited") {
          bieQualityScore = qs;
        }
        if (typeof meta.sources_count === "number") {
          bieSourcesCount = meta.sources_count;
        }
      } catch {
        // Non-fatal — metadata parse failure is safe to ignore
      }
    }
  }

  const rawManagementIntelligence =
    findSection("Management Intelligence") !== "Pending"
      ? findSection("Management Intelligence")
      : undefined;

  const memoData: MemoResearchData = {
    // Core BRE/BIE fields — BIE takes priority when version 3 narrative exists
    industry_overview: hasBIE
      ? extractBIESection("Industry Overview", "Industry Outlook") || "Pending"
      : sectionsToText(pack, "Industry Overview", "Industry Landscape", "Industry Outlook"),
    market_dynamics: hasBIE
      ? extractBIESection("Market Intelligence") || "Pending"
      : sectionsToText(
          pack,
          "Market Intelligence",
          "Market Demand",
          "Market Dynamics",
          "Demographics",
          "Institutional Insights",
        ),
    competitive_positioning: hasBIE
      ? extractBIESection("Competitive Landscape") || "Pending"
      : sectionsToText(pack, "Competitive Landscape", "Competitive Analysis"),
    regulatory_environment: hasBIE
      ? extractBIESection("Regulatory Environment") || "Pending"
      : sectionsToText(pack, "Regulatory Environment"),
    risk_indicators: pack.risk_indicators.map((ri: RiskIndicator) => ({
      category: ri.category,
      level: ri.level,
      summary: ri.summary,
    })),
    research_coverage: {
      missions_count: missions.length,
      facts_count: pack.total_facts,
      inferences_count: pack.total_inferences,
      sources_count: pack.total_sources,
      compiled_at: pack.compiled_at,
    },
    // BIE-specific fields
    credit_thesis:
      findSection("Credit Thesis") !== "Pending" ? findSection("Credit Thesis") : undefined,
    structure_implications:
      findSection("Structure Implications") !== "Pending"
        ? findSection("Structure Implications")
            .split("\n")
            .filter(Boolean)
        : undefined,
    underwriting_questions:
      findSection("Underwriting Questions") !== "Pending"
        ? findSection("Underwriting Questions")
            .split("\n")
            .filter(Boolean)
        : undefined,
    contradictions:
      findSection("Contradictions") !== "Pending"
        ? findSection("Contradictions")
            .split("\n")
            .filter(Boolean)
        : undefined,
    litigation_and_risk:
      findSection("Litigation and Risk") !== "Pending"
        ? findSection("Litigation and Risk")
        : undefined,
    transaction_analysis:
      findSection("Transaction Analysis") !== "Pending"
        ? findSection("Transaction Analysis")
        : undefined,
    three_five_year_outlook:
      findSection("3-Year and 5-Year Outlook") !== "Pending"
        ? findSection("3-Year and 5-Year Outlook")
        : undefined,
    research_quality_score: bieQualityScore,
    sources_count_bie: bieSourcesCount,
    // Phase 78: trust layer fields from quality gate
    trust_grade: qualityGateRes?.data?.trust_grade ?? undefined,
    quality_score: qualityGateRes?.data?.quality_score ?? undefined,
    entity_confidence: qualityGateRes?.data?.entity_confidence ?? undefined,
    entity_confirmed_name: missions[0].entity_confirmed_name ?? undefined,
    // management_intelligence and monitoring_triggers are set below after validation
    management_intelligence: undefined,
    monitoring_triggers: undefined,
  };

  // ── Layer 3: Management Intelligence Render Guard ───────────────────────────
  // Last-line-of-defense check at memo render time. Even if bad data made it
  // to storage (e.g., if Layer 2 was bypassed or not yet deployed), this
  // prevents hallucinated management profiles from appearing in credit memos.
  //
  // Logic: check whether the Management Intelligence text mentions any last
  // names from the deal's actual ownership_entities. If no match and we have
  // known owners, suppress the field entirely. Credit officers should never
  // see unverified management profiles for a deal.
  //
  // The Monitoring Triggers section is paired: it often references specific
  // management names (e.g. "departure of [Person]") — suppress it too when
  // Management Intelligence is suppressed.
  if (rawManagementIntelligence) {
    const mgmtTextLower = rawManagementIntelligence.toLowerCase();

    if (knownOwnerLastNames.size > 0) {
      // We have known owners — validate the section against them
      const anyKnownOwnerMentioned = [...knownOwnerLastNames].some((lastName) =>
        mgmtTextLower.includes(lastName)
      );

      if (anyKnownOwnerMentioned) {
        // Section is grounded in actual deal owners — safe to display
        memoData.management_intelligence = rawManagementIntelligence;
        const rawTriggers = findSection("Monitoring Triggers");
        if (rawTriggers !== "Pending") {
          memoData.monitoring_triggers = rawTriggers.split("\n").filter(Boolean);
        }
      } else {
        // Section names people not in the deal's ownership entities.
        // This is the hallucination pattern (e.g., web-scraped executive
        // profiles from a real company with a similar name). Suppress.
        console.warn(
          `[loadResearchForMemo] Layer 3 guard: Management Intelligence suppressed for deal ` +
          `${args.dealId}. Known owner last names: [${[...knownOwnerLastNames].join(", ")}]. ` +
          `None found in management intelligence text — likely hallucinated profiles.`
        );
        // management_intelligence and monitoring_triggers remain undefined (suppressed)
      }
    } else {
      // No ownership entities on file — cannot validate.
      // Suppress rather than display potentially hallucinated content.
      console.warn(
        `[loadResearchForMemo] Layer 3 guard: Management Intelligence suppressed for deal ` +
        `${args.dealId} — no ownership_entities found so output cannot be validated. ` +
        `Add ownership entities to enable management intelligence rendering.`
      );
      // management_intelligence and monitoring_triggers remain undefined (suppressed)
    }
  } else {
    // No management intelligence in storage — check Monitoring Triggers independently
    const rawTriggers = findSection("Monitoring Triggers");
    if (rawTriggers !== "Pending") {
      memoData.monitoring_triggers = rawTriggers.split("\n").filter(Boolean);
    }
  }
  // ── End Layer 3 Guard ────────────────────────────────────────────────────────

  return memoData;
}
