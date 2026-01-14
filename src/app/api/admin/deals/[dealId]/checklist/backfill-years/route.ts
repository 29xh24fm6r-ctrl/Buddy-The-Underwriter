import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { matchChecklistKeyFromFilename } from "@/lib/checklist/matchers";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";

export const dynamic = "force-dynamic";

async function allowSuperAdminOrDebugToken(req: NextRequest) {
  try {
    await requireSuperAdmin();
    return null;
  } catch {
    // fall through to token
  }

  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";
  const expected = process.env.ADMIN_DEBUG_TOKEN || "";
  if (!expected || token !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return null;
}

function mustToken(req: NextRequest) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";
  const expected = process.env.ADMIN_DEBUG_TOKEN || "";
  if (!expected || token !== expected) throw new Error("Unauthorized");
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    const auth = await allowSuperAdminOrDebugToken(req);
    if (auth) return auth;

    const { dealId } = await ctx.params;
    const sb = supabaseAdmin();

    const { data: docs, error } = await sb
      .from("deal_documents")
      .select("id, original_filename, checklist_key, doc_year")
      .eq("deal_id", dealId)
      .not("checklist_key", "is", null);

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    let updated = 0;

    for (const d of docs || []) {
      if (d.doc_year) continue;
      const m = matchChecklistKeyFromFilename(d.original_filename || "");
      if (!m.docYear) continue;

      const { error: updErr } = await sb
        .from("deal_documents")
        .update({ 
          doc_year: m.docYear, 
          match_confidence: m.confidence, 
          match_reason: m.reason, 
          match_source: "filename" 
        })
        .eq("id", d.id);

      if (!updErr) updated += 1;
    }

    return NextResponse.json({ ok: true, updated });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Failed" }, { status: 401 });
  }
}
