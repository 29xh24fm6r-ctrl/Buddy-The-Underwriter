import { NextRequest, NextResponse } from "next/server";
import { requireDealCockpitAccess, COCKPIT_ROLES } from "@/lib/auth/requireDealCockpitAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { extractFactsFromTranscript } from "@/lib/gapEngine/extractFactsFromTranscript";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ dealId: string }> }
) {
  try {
    const { dealId } = await props.params;
    const auth = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const body = await req.json().catch(() => ({}));
    const rawText: string = body.raw_text ?? "";
    const sourceLabel: string = body.source_label ?? "Uploaded notes";

    if (!rawText.trim() || rawText.length < 50) {
      return NextResponse.json({ ok: false, error: "transcript_too_short" }, { status: 400 });
    }

    const sb = supabaseAdmin();

    // Create the upload record
    const { data: upload } = await sb
      .from("deal_transcript_uploads")
      .insert({
        deal_id: dealId,
        bank_id: auth.bankId,
        uploaded_by: auth.userId,
        source_label: sourceLabel,
        raw_text: rawText,
        extraction_status: "processing",
      })
      .select("id")
      .single();

    // Extract candidates
    const extractResult = await extractFactsFromTranscript({ rawText, dealId });

    if (!extractResult.ok) {
      if (upload) {
        await sb
          .from("deal_transcript_uploads")
          .update({ extraction_status: "failed" })
          .eq("id", upload.id);
      }
      return NextResponse.json({ ok: false, error: extractResult.error }, { status: 500 });
    }

    // Save candidates back to upload record
    if (upload) {
      await sb
        .from("deal_transcript_uploads")
        .update({
          extraction_status: "complete",
          extracted_candidates: extractResult.candidates,
          processed_at: new Date().toISOString(),
        })
        .eq("id", upload.id);
    }

    return NextResponse.json({
      ok: true,
      upload_id: upload?.id ?? null,
      candidates: extractResult.candidates,
      candidate_count: extractResult.candidates.length,
    });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[transcript-ingest POST]", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
