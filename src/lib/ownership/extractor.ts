// src/lib/ownership/extractor.ts
import { supabaseAdmin } from "@/lib/supabase/admin";
import { discoverSchema, activateDocTextSource, getActiveDocTextSource } from "@/lib/admin/schemaDiscovery";

type DocRow = {
  doc_id: string | null;
  label: string | null;
  text: string;
  updated_at: string | null;
};

/**
 * Extract ownership from document text using discovered doc_text_source mapping.
 * 
 * Self-healing: If no mapping exists, auto-discovers and activates top candidate.
 * Returns [] safely if discovery fails.
 */
export async function extractOwnershipFindings(dealId: string) {
  const sb = supabaseAdmin();

  // Self-healing discovery: activate top candidate if no mapping exists
  let src = await getActiveDocTextSource();
  if (!src) {
    try {
      const disc = await discoverSchema();
      const top = disc.docText?.[0];
      if (top) {
        src = await activateDocTextSource({
          tableName: top.table,
          textColumn: top.column,
          dealIdColumn: "deal_id",
          documentIdColumn: "document_id",
          labelColumn: "doc_label",
          updatedAtColumn: "updated_at",
        });
      }
    } catch {
      // Discovery failed, return empty safely
      return [];
    }
  }
  if (!src) return [];

  const table = String(src.table_name);
  const textCol = String(src.text_column);
  const dealIdCol = src.deal_id_column ? String(src.deal_id_column) : null;
  const docIdCol = src.document_id_column ? String(src.document_id_column) : null;
  const labelCol = src.label_column ? String(src.label_column) : null;
  const updatedAtCol = src.updated_at_column ? String(src.updated_at_column) : null;

  // Build select list
  const selectCols = [
    docIdCol ? `${docIdCol}` : null,
    labelCol ? `${labelCol}` : null,
    `${textCol}`,
    updatedAtCol ? `${updatedAtCol}` : null,
  ].filter(Boolean);

  if (!dealIdCol) {
    // cannot filter by deal; bail safely
    return [];
  }

  let docs: DocRow[] = [];
  try {
    const { data, error } = await sb
      .from(table)
      .select(selectCols.join(","))
      .eq(dealIdCol, dealId)
      .limit(75);

    if (error) throw error;

    docs = (data ?? []).map((r: any) => ({
      doc_id: docIdCol ? (r[docIdCol] ? String(r[docIdCol]) : null) : null,
      label: labelCol ? (r[labelCol] ? String(r[labelCol]) : null) : null,
      text: String(r[textCol] ?? ""),
      updated_at: updatedAtCol ? (r[updatedAtCol] ? String(r[updatedAtCol]) : null) : null,
    }));
  } catch {
    return [];
  }

  const findings: Array<{
    full_name: string;
    ownership_percent: number | null;
    evidence_doc_id: string | null;
    evidence_doc_label: string | null;
    evidence_page: number | null;
    evidence_snippet: string | null;
    evidence_start: number | null;
    evidence_end: number | null;
    confidence: number;
  }> = [];

  // Stronger patterns for ownership extraction
  // Examples: "John Smith - 25%" OR "Member John Smith: 25.0%"
  const re = /(?:member|owner|shareholder|partner)?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\s*(?:-|—|:)\s*(\d{1,3}(?:\.\d+)?)\s*%/gi;

  for (const d of docs) {
    const text = d.text || "";
    if (!text) continue;

    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const fullName = String(m[1] ?? "").trim();
      const pct = Number(m[2]);

      if (!fullName || !Number.isFinite(pct) || pct <= 0 || pct > 100) continue;

      // Evidence span for live highlighting
      const start = Math.max(0, m.index - 80);
      const end = Math.min(text.length, m.index + 180);
      const snippet = text.slice(start, end).replace(/\s+/g, " ").trim();

      findings.push({
        full_name: fullName,
        ownership_percent: pct,
        evidence_doc_id: d.doc_id,
        evidence_doc_label: d.label ?? "Document",
        evidence_page: null,
        evidence_snippet: snippet.slice(0, 260),
        evidence_start: start,
        evidence_end: end,
        confidence: 0.65,
      });

      if (findings.length >= 20) break;
    }
    if (findings.length >= 20) break;
  }

  // Insert findings as "proposed" with evidence offsets
  for (const f of findings) {
    await sb.from("deal_ownership_findings").insert({
      deal_id: dealId,
      full_name: f.full_name,
      email: null,
      ownership_percent: f.ownership_percent,
      evidence_doc_id: f.evidence_doc_id,
      evidence_doc_label: f.evidence_doc_label,
      evidence_page: f.evidence_page,
      evidence_snippet: f.evidence_snippet,
      evidence_start: f.evidence_start,
      evidence_end: f.evidence_end,
      confidence: f.confidence,
      status: "proposed",
    });
  }

  return findings;
}
