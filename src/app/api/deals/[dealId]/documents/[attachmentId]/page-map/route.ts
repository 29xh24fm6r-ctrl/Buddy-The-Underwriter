import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { ensurePageMapForAttachment } from "@/lib/evidence/pageMap";

export const runtime = "nodejs";
// Spec D5: cockpit-supporting GET routes must allow headroom beyond the
// 10s default for cold-start auth + multi-step Supabase I/O.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ dealId: string; attachmentId: string }> },
) {

  const { dealId, attachmentId } = await ctx.params;
  await ensurePageMapForAttachment({ dealId, attachmentId });

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("document_ocr_page_map")
    .select("page_number, page_text, global_char_start, global_char_end")
    .eq("deal_id", dealId)
    .eq("attachment_id", attachmentId)
    .order("page_number", { ascending: true });

  if (error)
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  return NextResponse.json({ ok: true, pages: data || [] });
}
