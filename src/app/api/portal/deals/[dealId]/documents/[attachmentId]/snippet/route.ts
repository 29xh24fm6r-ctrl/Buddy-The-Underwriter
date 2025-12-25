import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireValidInvite } from "@/lib/portal/auth";
import { snippetWithHighlight } from "@/lib/evidence/spans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ dealId: string; attachmentId: string }> },
) {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) throw new Error("Missing authorization header");
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const invite = await requireValidInvite(token);

    const { dealId, attachmentId } = await ctx.params;
    if (invite.deal_id !== dealId) throw new Error("Deal ID mismatch");

    const url = new URL(req.url);
    const start = Number(url.searchParams.get("start") || 0);
    const end = Number(url.searchParams.get("end") || 0);

    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("document_ocr_results")
      .select("extracted_text")
      .eq("deal_id", dealId)
      .eq("attachment_id", attachmentId)
      .maybeSingle();

    if (error) throw error;
    const text = String(data?.extracted_text || "");
    if (!text)
      return NextResponse.json(
        { ok: false, error: "OCR text not found" },
        { status: 404 },
      );

    const snippet = snippetWithHighlight({
      text,
      start,
      end,
      contextChars: 140,
      hardMaxChars: 900,
    });
    return NextResponse.json({ ok: true, attachmentId, ...snippet });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "snippet_failed" },
      { status: 500 },
    );
  }
}
