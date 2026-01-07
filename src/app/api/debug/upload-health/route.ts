import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/debug/upload-health?dealId=...
 * 
 * Quick health check to verify documents are persisting to DB.
 * Returns count + recent docs for a deal.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const dealId = url.searchParams.get("dealId");
  
  if (!dealId) {
    return NextResponse.json(
      { ok: false, error: "Missing dealId query parameter" },
      { status: 400 }
    );
  }

  const sb = supabaseAdmin();
  const [{ data: docs, error: docsErr }, { data: checklist, error: checklistErr }] =
    await Promise.all([
      sb
        .from("deal_documents")
        .select(
          "id, original_filename, document_key, created_at, storage_path, checklist_key, match_source, match_confidence",
        )
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(10),
      sb
        .from("deal_checklist_items")
        .select("status")
        .eq("deal_id", dealId),
    ]);

  if (docsErr) {
    return NextResponse.json({ ok: false, error: docsErr.message }, { status: 500 });
  }

  // Non-fatal: this table may not exist in some environments.
  const checklistStatusCounts: Record<string, number> = {};
  if (!checklistErr && checklist && Array.isArray(checklist)) {
    for (const row of checklist) {
      const k = (row as any)?.status ?? "(null)";
      checklistStatusCounts[String(k)] = (checklistStatusCounts[String(k)] || 0) + 1;
    }
  }

  return NextResponse.json({
    ok: true,
    dealId,
    count: docs?.length ?? 0,
    docs: docs ?? [],
    checklist: checklistErr
      ? { ok: false, error: checklistErr.message }
      : { ok: true, status_counts: checklistStatusCounts },
    timestamp: new Date().toISOString(),
  });
}
