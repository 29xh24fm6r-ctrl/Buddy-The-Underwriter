import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Phase 79: Memo → Evidence Drillthrough
 *
 * Resolves evidence rows from buddy_research_evidence for a given memo
 * section. Used by the memo UI to let bankers drill from narrative text
 * into the underlying claims, sources, and thread origins.
 */

export type MemoEvidenceRow = {
  id: string;
  mission_id: string;
  section: string;
  claim_text: string;
  layer: string;           // "fact" | "inference" | "narrative"
  thread_origin: string;   // "borrower" | "management" | "competitive" etc.
  source_uris: string[];
  source_types: string[];
  confidence: number | null;
  memo_field: string | null;
  created_at: string;
};

/**
 * Load evidence rows for a specific memo section.
 */
export async function loadEvidenceForMemoSection(
  dealId: string,
  sectionKey: string,
): Promise<MemoEvidenceRow[]> {
  const sb = supabaseAdmin();

  // Find latest completed mission for this deal
  const { data: mission } = await (sb as any)
    .from("buddy_research_missions")
    .select("id")
    .eq("deal_id", dealId)
    .eq("status", "complete")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!mission) return [];

  const { data, error } = await (sb as any)
    .from("buddy_research_evidence")
    .select("*")
    .eq("mission_id", mission.id)
    .eq("section", sectionKey);

  if (error || !data) return [];
  return data as MemoEvidenceRow[];
}

/**
 * Load all evidence rows for a deal, grouped by section.
 * Used by the memo UI to render "View Evidence" for all sections at once.
 */
export async function loadAllEvidenceForDeal(
  dealId: string,
): Promise<Map<string, MemoEvidenceRow[]>> {
  const sb = supabaseAdmin();

  const { data: mission } = await (sb as any)
    .from("buddy_research_missions")
    .select("id")
    .eq("deal_id", dealId)
    .eq("status", "complete")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!mission) return new Map();

  const { data, error } = await (sb as any)
    .from("buddy_research_evidence")
    .select("*")
    .eq("mission_id", mission.id)
    .order("created_at", { ascending: true });

  if (error || !data) return new Map();

  const grouped = new Map<string, MemoEvidenceRow[]>();
  for (const row of data as MemoEvidenceRow[]) {
    const arr = grouped.get(row.section) ?? [];
    arr.push(row);
    grouped.set(row.section, arr);
  }
  return grouped;
}

/**
 * Build a research trace object for persistence in canonical_memo_narratives.
 * Called during memo generation to snapshot the evidence trail.
 */
export async function buildResearchTrace(
  dealId: string,
): Promise<{ sections: Array<{ section_key: string; claim_ids: string[]; evidence_count: number }> } | null> {
  const evidenceBySection = await loadAllEvidenceForDeal(dealId);
  if (evidenceBySection.size === 0) return null;

  const sections: Array<{ section_key: string; claim_ids: string[]; evidence_count: number }> = [];

  for (const [sectionKey, rows] of evidenceBySection.entries()) {
    sections.push({
      section_key: sectionKey,
      claim_ids: rows.map((r) => r.id),
      evidence_count: rows.length,
    });
  }

  return { sections };
}
