// src/lib/packs/getPackRecommendation.ts
// Get best pack for a deal with confidence level

import { supabaseAdmin } from "@/lib/supabase/admin";
import { scorePackMatch } from "./matchPack";

export type PackRecommendation = {
  packId: string;
  packName: string;
  matchScore: number;
  rank: number;
  confidenceLevel: "auto" | "suggest" | "manual";
  reasoning: {
    sampleSize: number;
    avgBlockers: number;
    overrideRate: number;
    avgDays: number;
  };
};

export async function getPackRecommendation(
  dealId: string
): Promise<PackRecommendation | null> {
  const sb = supabaseAdmin();

  // Load deal
  const { data: deal, error: dealErr } = await sb
    .from("deals")
    .select("id, bank_id, loan_type, loan_program")
    .eq("id", dealId)
    .single();

  if (dealErr || !deal) return null;

  // Load active packs for this bank
  const { data: packs, error: packErr } = await sb
    .from("borrower_pack_templates")
    .select("id, name, loan_type, loan_program")
    .eq("bank_id", deal.bank_id)
    .eq("active", true);

  if (packErr || !packs || packs.length === 0) return null;

  // Score each pack
  const scored = packs.map((pack) => ({
    ...pack,
    score: scorePackMatch(pack, {
      loan_type: deal.loan_type,
      loan_program: deal.loan_program,
    }),
  }));

  // Sort by score desc
  scored.sort((a, b) => b.score - a.score);

  const bestPack = scored[0];
  if (!bestPack || bestPack.score < 70) return null;

  // Load confidence for this pack
  const { data: confidence } = await sb
    .from("borrower_pack_confidence")
    .select("*")
    .eq("pack_template_id", bestPack.id)
    .maybeSingle();

  const confidenceLevel = (confidence?.confidence_level as "auto" | "suggest" | "manual") || "manual";
  const sampleSize = confidence?.sample_size || 0;
  const avgBlockers = confidence?.avg_blockers || 0;
  const overrideRate = confidence?.override_rate || 0;
  const avgDays = confidence?.avg_days || 0;

  return {
    packId: bestPack.id,
    packName: bestPack.name,
    matchScore: bestPack.score,
    rank: 1,
    confidenceLevel,
    reasoning: {
      sampleSize,
      avgBlockers,
      overrideRate,
      avgDays,
    },
  };
}
