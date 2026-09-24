import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScoreInputs } from "./inputs";

/** The same reference evidence drives scoring and package freshness. Selecting
 * a brand never creates or changes the reference directory's eligibility. */
export async function loadFranchiseScoreEvidence(sb: SupabaseClient, dealId: string): Promise<ScoreInputs["franchise"]> {
  const link = await sb.from("deal_franchises").select("brand_id").eq("deal_id", dealId).maybeSingle();
  if (link.error) throw new Error("franchise_evidence_unavailable");
  if (!link.data?.brand_id) return null;
  const [brand, item19] = await Promise.all([
    sb.from("franchise_brands")
      .select("id,unit_count,founding_year,sba_eligible,sba_certification_status,has_item_19")
      .eq("id", link.data.brand_id).maybeSingle(),
    sb.from("fdd_item19_facts").select("percentile_rank").eq("brand_id", link.data.brand_id)
      .order("percentile_rank", { ascending: false }).limit(1),
  ]);
  if (brand.error || item19.error || !brand.data) throw new Error("franchise_evidence_unavailable");
  const number = (value: unknown): number | null => {
    if (value == null || value === "" || typeof value === "boolean") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  return {
    brandId: brand.data.id,
    unitCount: number(brand.data.unit_count),
    foundingYear: number(brand.data.founding_year),
    sbaEligible: brand.data.sba_eligible ?? null,
    sbaCertificationStatus: brand.data.sba_certification_status ?? null,
    hasItem19: brand.data.has_item_19 ?? null,
    item19PercentileRank: number(item19.data?.[0]?.percentile_rank),
  };
}
