import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type EvidenceCoverageResult = {
  totalSections: number;
  supportedSections: number;
  unsupportedSections: number;
  supportRatio: number; // 0.0–1.0
  sectionBreakdown: Array<{
    sectionKey: string;
    evidenceCount: number;
    supported: boolean;
  }>;
};

/**
 * Compute evidence coverage from research_trace_json on the latest generated memo.
 * Uses section-level evidence counts — no NLP sentence matching required.
 * Returns null when no memo has been generated yet (new deals).
 */
export async function computeEvidenceCoverage(
  dealId: string,
  bankId: string,
): Promise<EvidenceCoverageResult | null> {
  const sb = supabaseAdmin();

  const { data } = await (sb as any)
    .from("canonical_memo_narratives")
    .select("research_trace_json")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data?.research_trace_json) return null;

  const trace = data.research_trace_json as {
    sections: Array<{ section_key: string; claim_ids: string[]; evidence_count: number }>;
  };

  if (!trace.sections?.length) return null;

  const MIN_EVIDENCE_FOR_SUPPORTED = 1;
  const breakdown = trace.sections.map((s) => ({
    sectionKey: s.section_key,
    evidenceCount: s.evidence_count,
    supported: s.evidence_count >= MIN_EVIDENCE_FOR_SUPPORTED,
  }));

  const totalSections = breakdown.length;
  const supportedSections = breakdown.filter((s) => s.supported).length;

  return {
    totalSections,
    supportedSections,
    unsupportedSections: totalSections - supportedSections,
    supportRatio: totalSections > 0 ? supportedSections / totalSections : 0,
    sectionBreakdown: breakdown,
  };
}
