import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  compileCreditCommitteePack,
  type CreditCommitteePack,
  type RiskIndicator,
} from "@/lib/research/creditCommitteePack";

export type MemoResearchData = {
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
};

const SECTION_MAP: Record<string, keyof Pick<MemoResearchData, "industry_overview" | "market_dynamics" | "competitive_positioning" | "regulatory_environment">> = {
  "Industry Landscape": "industry_overview",
  "Market Demand": "market_dynamics",
  "Demographics": "market_dynamics",
  "Competitive Analysis": "competitive_positioning",
  "Regulatory Environment": "regulatory_environment",
};

function sectionsToText(pack: CreditCommitteePack, ...titles: string[]): string {
  const parts: string[] = [];
  for (const section of pack.sections) {
    if (titles.includes(section.title)) {
      const text = section.content
        .map((s) => s.text)
        .filter((t) => t.length > 0)
        .join("\n");
      if (text) parts.push(text);
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
    .limit(20);

  if (missionsErr || !missions?.length) return null;

  // Load facts, inferences, sources for all missions in parallel
  const missionIds = missions.map((m: any) => m.id);

  const [factsRes, inferencesRes, sourcesRes] = await Promise.all([
    (sb as any)
      .from("buddy_research_facts")
      .select("*")
      .in("mission_id", missionIds),
    (sb as any)
      .from("buddy_research_inferences")
      .select("*")
      .in("mission_id", missionIds),
    (sb as any)
      .from("buddy_research_sources")
      .select("*")
      .in("mission_id", missionIds),
  ]);

  const allFacts = (factsRes.data ?? []) as any[];
  const allInferences = (inferencesRes.data ?? []) as any[];
  const allSources = (sourcesRes.data ?? []) as any[];

  if (allFacts.length === 0) return null;

  // Group by mission
  const missionData = missions.map((m: any) => ({
    mission: m,
    facts: allFacts.filter((f: any) => f.mission_id === m.id),
    inferences: allInferences.filter((i: any) => i.mission_id === m.id),
    sources: allSources.filter((s: any) => s.mission_id === m.id),
  }));

  // Compile the credit committee pack
  const result = compileCreditCommitteePack({
    deal_id: args.dealId,
    bank_id: args.bankId ?? null,
    missions: missionData,
  });

  if (!result.ok || !result.pack) return null;

  const pack = result.pack;

  return {
    industry_overview: sectionsToText(pack, "Industry Landscape"),
    market_dynamics: sectionsToText(pack, "Market Demand", "Demographics"),
    competitive_positioning: sectionsToText(pack, "Competitive Analysis"),
    regulatory_environment: sectionsToText(pack, "Regulatory Environment"),
    risk_indicators: pack.risk_indicators.map((ri) => ({
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
  };
}
