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
  adversarial_check_id: string | null;
  created_at: string;
};

/**
 * Normalize a raw buddy_research_evidence row into a MemoEvidenceRow.
 *
 * Physical schema: evidence_type (enum) + supporting_data (JSONB) hold the
 * fields the application model exposes as flat properties. This reader
 * unpacks supporting_data so callers see the logical shape regardless of
 * storage layout.
 */
function normalizeEvidenceRow(raw: any): MemoEvidenceRow {
  const sd = (raw?.supporting_data ?? {}) as Record<string, unknown>;
  return {
    id: String(raw?.id ?? ""),
    mission_id: String(raw?.mission_id ?? ""),
    section: (sd.section as string | undefined) ?? "",
    claim_text: String(raw?.claim ?? ""),
    layer: String(raw?.evidence_type ?? ""),
    thread_origin: (sd.thread_origin as string | undefined) ?? "",
    source_uris: Array.isArray(sd.source_uris) ? (sd.source_uris as string[]) : [],
    source_types: Array.isArray(sd.source_types) ? (sd.source_types as string[]) : [],
    confidence: typeof raw?.confidence === "number" ? raw.confidence : null,
    memo_field: (sd.memo_field as string | undefined) ?? null,
    adversarial_check_id: (sd.adversarial_check_id as string | undefined) ?? null,
    created_at: String(raw?.created_at ?? ""),
  };
}

/**
 * Load evidence rows for a specific memo section.
 */
export async function loadEvidenceForMemoSection(
  dealId: string,
  sectionKey: string,
): Promise<MemoEvidenceRow[]> {
  const all = await loadAllEvidenceForDeal(dealId);
  return all.get(sectionKey) ?? [];
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
  for (const raw of data as any[]) {
    const row = normalizeEvidenceRow(raw);
    if (!row.section) continue;
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
