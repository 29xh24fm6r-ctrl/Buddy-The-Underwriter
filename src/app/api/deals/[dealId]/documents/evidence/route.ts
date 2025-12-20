import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EvidenceSource = {
  table: string;
  select: string;
  dealCol: string;
};

export async function GET(_: Request, { params }: { params: { dealId: string } }) {
  const dealId = params.dealId;
  const sb = supabaseAdmin();

  // Canonical sources list:
  // Replace deal_files with deal_documents; keep response compatible where needed.
  const sources: EvidenceSource[] = [
    // Canonical docs
    {
      table: "deal_documents",
      select:
        "id, storage_bucket, storage_path, original_filename, mime_type, created_at, deal_id, source, checklist_key",
      dealCol: "deal_id",
    },
    // If you have other evidence tables, keep them here as-is.
    // Example placeholders (leave if they exist in your project):
    // { table: "deal_notes", select: "id, created_at, deal_id, body", dealCol: "deal_id" },
  ];

  const results: Record<string, any[]> = {};

  for (const s of sources) {
    const { data, error } = await sb
      .from(s.table)
      .select(s.select)
      .eq(s.dealCol, dealId)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { ok: false, error: `Evidence query failed for ${s.table}: ${error.message}` },
        { status: 500 }
      );
    }

    // Back-compat mapping for "files evidence" shape (if any consumer expects deal_files fields)
    if (s.table === "deal_documents") {
      results["deal_files"] = (data ?? []).map((d: any) => ({
        file_id: d.id,
        stored_name: d.storage_path,
        original_name: d.original_filename,
        mime_type: d.mime_type,
        created_at: d.created_at,
        deal_id: d.deal_id,
        storage_bucket: d.storage_bucket,
        storage_path: d.storage_path,
        source: d.source,
        checklist_key: d.checklist_key,
      }));
      continue;
    }

    results[s.table] = data ?? [];
  }

  return NextResponse.json({ ok: true, evidence: results });
}
