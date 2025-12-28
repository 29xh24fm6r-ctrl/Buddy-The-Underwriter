import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Pipeline steps (minimal but end-to-end):
 * 1) For any deal_uploads in 'uploaded' -> mark 'extracting' and create doc_extractions row (queued)
 * 2) If you already have OCR/extraction elsewhere, replace this stub with your real call and then upsert doc_fields
 * 3) Update deal_uploads -> 'needs_review' if any doc_fields.needs_attention true else 'extracted'
 * 4) Emit deal_events for progress so cockpit can show timeline
 */
export async function POST(_: Request, ctx: { params: Promise<{ dealId: string }> }) {
  const sb = supabaseAdmin();
  const { dealId } = await ctx.params;

  const { data: uploads, error } = await sb
    .from("deal_uploads")
    .select("upload_id, checklist_key, status")
    .eq("deal_id", dealId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const uploaded = (uploads ?? []).filter((u: any) => u.status === "uploaded");
  for (const u of uploaded) {
    await sb.from("deal_uploads").update({ status: "extracting" }).eq("deal_id", dealId).eq("upload_id", u.upload_id);

    await sb.from("doc_extractions").upsert({
      deal_id: dealId,
      upload_id: u.upload_id,
      status: "queued",
      confidence: null,
      extracted_json: null,
      error: null,
    }, { onConflict: "deal_id,upload_id" });

    await sb.from("deal_events").insert({
      deal_id: dealId,
      kind: "extraction_queued",
      payload: { upload_id: u.upload_id },
    });
  }

  // Stub extraction -> seed doc_fields if empty
  for (const u of (uploads ?? [])) {
    const { data: existingFields } = await sb
      .from("doc_fields")
      .select("id")
      .eq("deal_id", dealId)
      .eq("upload_id", u.upload_id)
      .limit(1);

    if (!existingFields || existingFields.length === 0) {
      // Minimal example fields; replace with real extraction output mapping
      await sb.from("doc_fields").insert([
        { deal_id: dealId, upload_id: u.upload_id, field_key: "property_name", field_label: "Property Name", field_value: "Unknown", needs_attention: true },
        { deal_id: dealId, upload_id: u.upload_id, field_key: "reporting_period", field_label: "Reporting Period", field_value: "Unknown", needs_attention: true },
      ]);

      await sb.from("doc_extractions").upsert({
        deal_id: dealId,
        upload_id: u.upload_id,
        status: "extracted",
        confidence: 0.5,
        extracted_json: { stub: true },
        error: null,
      }, { onConflict: "deal_id,upload_id" });

      await sb.from("deal_uploads").update({ status: "needs_review", confidence: 0.5 }).eq("deal_id", dealId).eq("upload_id", u.upload_id);

      await sb.from("deal_events").insert({
        deal_id: dealId,
        kind: "extraction_complete",
        payload: { upload_id: u.upload_id, stub: true },
      });
    }
  }

  return NextResponse.json({ ok: true, queued: uploaded.length });
}
