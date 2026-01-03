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
  const { data, error } = await sb
    .from("deal_documents")
    .select("id, original_filename, document_key, created_at, storage_path")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    dealId,
    count: data?.length ?? 0,
    docs: data ?? [],
    timestamp: new Date().toISOString(),
  });
}
